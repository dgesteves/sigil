// Hidden verifier: everything in deploy/k8s is admitted by Pod Security Admission at
// enforce=restricted, enforce-version=latest (Kubernetes 1.37), the pods would really start (the
// kubelet's runAsNonRoot image check), root filesystems are read-only, and the app keeps working:
// same images, commands and init steps, a writable temp dir for the label renderer, and the
// corporate CA from the corp-root-ca ConfigMap where NODE_EXTRA_CA_CERTS points.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  allContainers,
  checkTools,
  configMapFileSource,
  containerEnv,
  describe,
  dockerfileFinalStage,
  kubeletRunAsNonRootError,
  loadManifests,
  mountFor,
  podTemplates,
  pssRestricted,
  schemaProblems,
  selectorMatches,
  writableScratch,
} from './k8s-lib.mjs'

const root = process.cwd()
const here = new URL('.', import.meta.url).pathname
const TOOLS = JSON.parse(readFileSync(join(here, 'tools.json'), 'utf8'))
const loaded = loadManifests(root)
const templates = podTemplates(loaded.objects)
const objects = loaded.objects.map((o) => o.obj)

const APP = 'ghcr.io/parcelhub/parcelhub:4.2.0'
const BUSYBOX = 'busybox:1.37@sha256:a7dbc319b1438115a207e11930dc4bb3e643dcb3ec0bdd694bb36cd8fad289ec'
const WAIT = ['sh', '-c', 'until nc -z -w 2 "$DB_HOST" 5432; do echo "waiting for $DB_HOST"; sleep 2; done']

// What each workload ran before the change. `tmp`: renders labels into os.tmpdir(); `ca`: calls
// carriers through the TLS-intercepting proxy.
const ORIGINAL = {
  'Deployment/api': {
    initContainers: [
      { image: BUSYBOX, argv: WAIT },
      { image: APP, argv: ['node', 'src/migrate.js'] },
    ],
    containers: [{ image: APP, argv: ['node', 'src/server.js'], tmp: true, ca: true }],
  },
  'Deployment/worker': {
    initContainers: [],
    containers: [{ image: APP, argv: ['node', 'src/worker.js'], tmp: true, ca: true }],
  },
  'CronJob/nightly-cleanup': {
    initContainers: [],
    containers: [{ image: APP, argv: ['node', 'src/cleanup.js'] }],
  },
}

const argv = (c) => [...(c.command ?? []), ...(c.args ?? [])]
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

function template(key) {
  const [kind, name] = key.split('/')
  return templates.find((t) => t.kind === kind && t.name === name)
}

/** Maps each original container to its counterpart in the current manifests (by image and argv). */
function counterparts(key) {
  const t = template(key)
  if (!t) return { problems: [`${key} is missing from deploy/k8s`] }
  const problems = []
  const found = {}
  for (const type of ['initContainers', 'containers']) {
    const current = t.spec[type] ?? []
    let last = -1
    found[type] = ORIGINAL[key][type].map((want) => {
      const i = current.findIndex((c) => c.image === want.image && same(argv(c), want.argv))
      if (i < 0) problems.push(`${key}: the ${type} entry running ${JSON.stringify(want.argv)} in ${want.image} is gone or changed`)
      else if (i < last) problems.push(`${key}: init steps run in a different order`)
      last = Math.max(last, i)
      return i < 0 ? undefined : { ...current[i], _want: want }
    })
  }
  return { t, found, problems }
}

/** Image config User for the images these workloads run. */
function imageUser(image) {
  if (image === BUSYBOX) return { known: true, user: '' } // busybox sets no USER: uid 0
  if (image.startsWith('ghcr.io/parcelhub/parcelhub:')) {
    const stage = dockerfileFinalStage(readFileSync(join(root, 'Dockerfile'), 'utf8'))
    return { known: true, user: stage?.user ?? '' }
  }
  return { known: false }
}

test('manifests validate against the Kubernetes 1.37 API (strict schemas)', () => {
  assert.deepEqual(checkTools(root, TOOLS), [], 'the pinned validator from setup is missing or modified')
  const problems = schemaProblems(root, loaded)
  assert.deepEqual(problems, [], `schema validation failed:\n${describe(problems)}`)
})

test('api, worker and nightly-cleanup keep their images, commands and init steps', () => {
  const problems = Object.keys(ORIGINAL).flatMap((key) => counterparts(key).problems)
  const api = template('Deployment/api')
  const service = loaded.objects.find((o) => o.obj?.kind === 'Service' && o.obj.metadata?.name === 'api')?.obj
  if (api && service) {
    if (!selectorMatches({ matchLabels: service.spec?.selector ?? {} }, api.metadata.labels ?? {}))
      problems.push('Service api no longer selects the api pods')
    const server = (api.spec.containers ?? []).find((c) => c.image === APP && same(argv(c), ['node', 'src/server.js']))
    if (server && !(server.ports ?? []).some((p) => p.containerPort === 8080 && p.name === 'http'))
      problems.push('the api container no longer exposes port 8080 as "http" (the Service and probes use it)')
  }
  assert.deepEqual(problems, [], describe(problems))
})

test('every pod template is admitted under Pod Security Standards restricted (latest)', () => {
  assert.ok(templates.length >= 3, 'expected the api, worker and nightly-cleanup pod templates')
  const problems = templates.flatMap((t) =>
    pssRestricted(t.metadata, t.spec).map((v) => `${t.kind}/${t.name}: ${v}`),
  )
  assert.deepEqual(problems, [], `PodSecurity "restricted:latest" would reject:\n${describe(problems)}`)
})

test('every container passes the kubelet runAsNonRoot check against its image user', () => {
  const problems = []
  for (const t of templates) {
    for (const c of allContainers(t.spec)) {
      const img = imageUser(c.image ?? '')
      if (!img.known) {
        const err = kubeletRunAsNonRootError(t.spec, c, 'unknown-image-user')
        if (err) problems.push(`${t.kind}/${t.name}: ${c.name} uses ${c.image}, whose image user cannot be checked offline; set a numeric runAsUser`)
        continue
      }
      const err = kubeletRunAsNonRootError(t.spec, c, img.user)
      if (err) problems.push(`${t.kind}/${t.name}: CreateContainerConfigError: ${err}`)
    }
  }
  assert.deepEqual(problems, [], `the kubelet would refuse to start:\n${describe(problems)}`)
})

test('every container has a read-only root filesystem', () => {
  const problems = templates.flatMap((t) =>
    allContainers(t.spec)
      .filter((c) => c.securityContext?.readOnlyRootFilesystem !== true)
      .map((c) => `${t.kind}/${t.name}: ${c.name} does not set securityContext.readOnlyRootFilesystem: true`),
  )
  assert.deepEqual(problems, [], describe(problems))
})

test('the label renderer still has a writable temp dir', () => {
  const problems = []
  for (const key of Object.keys(ORIGINAL)) {
    const { t, found } = counterparts(key)
    if (!t) continue
    for (const c of found.containers ?? []) {
      if (!c?._want.tmp) continue
      const dir = containerEnv(c, objects).TMPDIR ?? '/tmp'
      if (!writableScratch(t.spec, c, dir))
        problems.push(`${key}: ${c.name} writes label PDFs to ${dir}, which is not a writable emptyDir/ephemeral volume`)
    }
  }
  assert.deepEqual(problems, [], describe(problems))
})

test('the corporate CA comes from the corp-root-ca ConfigMap at NODE_EXTRA_CA_CERTS', () => {
  const problems = []
  for (const key of Object.keys(ORIGINAL)) {
    const { t, found } = counterparts(key)
    if (!t) continue
    for (const c of found.containers ?? []) {
      if (!c?._want.ca) continue
      const path = containerEnv(c, objects).NODE_EXTRA_CA_CERTS
      if (!path) {
        problems.push(`${key}: ${c.name} no longer sets NODE_EXTRA_CA_CERTS`)
        continue
      }
      const hit = mountFor(t.spec, c, path)
      const src = hit ? configMapFileSource(hit.volume, hit.inVolume) : undefined
      if (!src || src.configMap !== 'corp-root-ca' || src.key !== 'ca.crt')
        problems.push(`${key}: ${c.name} reads the CA from ${path}, which is not key ca.crt of the corp-root-ca ConfigMap`)
    }
  }
  assert.deepEqual(problems, [], describe(problems))
})
