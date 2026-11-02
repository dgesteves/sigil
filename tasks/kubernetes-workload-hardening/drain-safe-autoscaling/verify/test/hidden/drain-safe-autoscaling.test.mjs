// Hidden verifier: search-api gets an HPA (3-12 replicas, 70% average CPU) that can actually
// compute utilization for its pods, and exactly one PodDisruptionBudget that lets automated drains
// evict a pod at every scale, never lets two go at once, and does not block drains when the pods are
// crash-looping. Eviction decisions are simulated with the disruption controller and eviction
// subresource logic of Kubernetes v1.37.2.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  allContainers,
  checkTools,
  describe,
  evictionAllowed,
  isSidecar,
  loadManifests,
  podTemplates,
  quantity,
  schemaProblems,
  selectorMatches,
} from './k8s-lib.mjs'

const root = process.cwd()
const here = new URL('.', import.meta.url).pathname
const TOOLS = JSON.parse(readFileSync(join(here, 'tools.json'), 'utf8'))
const loaded = loadManifests(root)
const objects = loaded.objects.map((o) => o.obj).filter((o) => o && typeof o === 'object')
const templates = podTemplates(loaded.objects)
const api = templates.find((t) => t.kind === 'Deployment' && t.name === 'search-api')
const MIN = 3
const MAX = 12

const hpas = objects.filter(
  (o) =>
    o.kind === 'HorizontalPodAutoscaler' &&
    o.spec?.scaleTargetRef?.kind === 'Deployment' &&
    o.spec?.scaleTargetRef?.name === 'search-api' &&
    o.spec?.scaleTargetRef?.apiVersion === 'apps/v1',
)

/** The CPU target of an HPA, normalised: { type: 'Resource' | 'ContainerResource', container?, utilization }. */
function cpuTarget(hpa) {
  if (hpa.apiVersion === 'autoscaling/v1')
    return { type: 'Resource', utilization: hpa.spec?.targetCPUUtilizationPercentage ?? 80 }
  const metrics = hpa.spec?.metrics
  if (!metrics?.length) return { type: 'Resource', utilization: 80 } // the controller's default
  for (const m of metrics) {
    if (m.type === 'Resource' && m.resource?.name === 'cpu' && m.resource.target?.type === 'Utilization')
      return { type: 'Resource', utilization: m.resource.target.averageUtilization }
    if (
      m.type === 'ContainerResource' &&
      m.containerResource?.name === 'cpu' &&
      m.containerResource.target?.type === 'Utilization'
    )
      return {
        type: 'ContainerResource',
        container: m.containerResource.container,
        utilization: m.containerResource.target.averageUtilization,
      }
  }
  return undefined
}

/** Requests default to limits when only limits are set. */
const cpuRequest = (resources) => quantity(resources?.requests?.cpu ?? resources?.limits?.cpu)

test('manifests validate against the Kubernetes 1.37 API (strict schemas)', () => {
  assert.deepEqual(checkTools(root, TOOLS), [], 'the pinned validator from setup is missing or modified')
  const problems = schemaProblems(root, loaded)
  assert.deepEqual(problems, [], `schema validation failed:\n${describe(problems)}`)
})

test('search-api autoscales between 3 and 12 replicas on 70% average CPU utilization', () => {
  assert.ok(api, 'Deployment search-api is missing')
  assert.equal(hpas.length, 1, `expected exactly one HorizontalPodAutoscaler for Deployment search-api, found ${hpas.length}`)
  const [hpa] = hpas
  assert.equal(hpa.spec.minReplicas ?? 1, MIN, 'minReplicas')
  assert.equal(hpa.spec.maxReplicas, MAX, 'maxReplicas')
  const target = cpuTarget(hpa)
  assert.ok(target, 'the HPA has no CPU utilization target')
  assert.equal(target.utilization, 70, 'CPU averageUtilization')
  if (target.type === 'ContainerResource')
    assert.ok(
      (api.spec.containers ?? []).some((c) => c.name === target.container),
      `ContainerResource targets container ${target.container}, which search-api does not have`,
    )
})

test('the HPA can compute CPU utilization for the search-api pods', () => {
  assert.ok(api && hpas.length === 1, 'needs the search-api Deployment and its HPA')
  const target = cpuTarget(hpas[0])
  assert.ok(target, 'the HPA has no CPU utilization target')
  // replica_calculator.go: pod-level requests win when set (PodLevelResources, on by default since
  // 1.34) unless the metric names a container; otherwise every app container and every sidecar
  // (restartPolicy: Always init container) needs a CPU request.
  const problems = []
  if (target.type === 'ContainerResource') {
    const c = (api.spec.containers ?? []).find((x) => x.name === target.container)
    if (!(cpuRequest(c?.resources) > 0)) problems.push(`container ${target.container} has no CPU request`)
  } else if (api.spec.resources?.requests && Object.keys(api.spec.resources.requests).length) {
    if (!(quantity(api.spec.resources.requests.cpu) > 0)) problems.push('pod-level resources.requests has no cpu')
  } else {
    for (const c of allContainers(api.spec).filter((x) => x._type === 'containers' || isSidecar(x)))
      if (!(cpuRequest(c.resources) > 0))
        problems.push(`missing request for cpu in container ${c.name}: utilization for these pods is undefined and the HPA will not scale`)
  }
  assert.deepEqual(problems, [], describe(problems))
})

test('exactly one PodDisruptionBudget covers search-api, and only search-api', () => {
  assert.ok(api, 'Deployment search-api is missing')
  const labels = api.metadata.labels ?? {}
  const pdbs = objects.filter((o) => o.kind === 'PodDisruptionBudget' && selectorMatches(o.spec?.selector, labels))
  assert.equal(pdbs.length, 1, `expected one PodDisruptionBudget selecting the search-api pods, found ${pdbs.length} (the eviction API refuses pods covered by several)`)
  const others = templates.filter((t) => t !== api && selectorMatches(pdbs[0].spec.selector, t.metadata.labels ?? {}))
  assert.deepEqual(
    others.map((t) => `${t.kind}/${t.name}`),
    [],
    'the budget also selects pods of other workloads, which then share (and use up) its disruptions',
  )
})

function pdbForApi() {
  const labels = api?.metadata.labels ?? {}
  const pdbs = objects.filter((o) => o.kind === 'PodDisruptionBudget' && selectorMatches(o.spec?.selector, labels))
  return pdbs.length === 1 ? pdbs[0] : undefined
}

const pods = (n, state) => Array.from({ length: n }, (_, i) => ({ name: `search-api-${i}`, ...state }))
const HEALTHY = { phase: 'Running', ready: true }
const CRASHLOOP = { phase: 'Running', ready: false }

test('a drain can evict a healthy search-api pod at every replica count from 3 to 12', () => {
  const pdb = pdbForApi()
  assert.ok(pdb, 'no single PodDisruptionBudget for search-api')
  const blocked = []
  for (let r = MIN; r <= MAX; r++) if (!evictionAllowed(pdb, pods(r, HEALTHY), r, 'search-api-0')) blocked.push(r)
  assert.deepEqual(blocked, [], `with all pods healthy, evicting one is refused at ${blocked.join(', ')} replicas, so the drain never completes`)
})

test('the budget never lets a second search-api pod go while one is already down', () => {
  const pdb = pdbForApi()
  assert.ok(pdb, 'no single PodDisruptionBudget for search-api')
  const allowed = []
  for (let r = MIN; r <= MAX; r++) {
    // One pod was evicted; its replacement is still starting (Pending, or Running but not Ready yet).
    for (const replacement of [{ phase: 'Pending', ready: false }, { phase: 'Running', ready: false }]) {
      const current = [...pods(r - 1, HEALTHY), { name: 'search-api-new', ...replacement }]
      if (evictionAllowed(pdb, current, r, 'search-api-0')) allowed.push(`${r} replicas (replacement ${replacement.phase})`)
    }
  }
  assert.deepEqual(allowed, [], `a second healthy pod can be evicted at:\n${describe(allowed)}`)
})

test('crash-looping search-api pods do not block a drain', () => {
  const pdb = pdbForApi()
  assert.ok(pdb, 'no single PodDisruptionBudget for search-api')
  const blocked = []
  for (let r = MIN; r <= MAX; r++) {
    // A bad release: every pod is Running but never becomes Ready. Drain a node holding several.
    let current = pods(r, CRASHLOOP)
    for (let k = 0; k < Math.min(3, r); k++) {
      const target = current[0].name
      if (!evictionAllowed(pdb, current, r, target)) {
        blocked.push(`${r} replicas, eviction #${k + 1}`)
        break
      }
      current = [...current.slice(1), { name: `search-api-new-${k}`, phase: 'Pending', ready: false }]
    }
    // One pod crash-looping among healthy ones: the broken pod itself can always go.
    const mixed = [...pods(r - 1, HEALTHY), { name: 'search-api-bad', ...CRASHLOOP }]
    if (!evictionAllowed(pdb, mixed, r, 'search-api-bad')) blocked.push(`${r} replicas, one crash-looping pod`)
  }
  assert.deepEqual(blocked, [], `evicting unhealthy pods is refused at:\n${describe(blocked)}`)
})
