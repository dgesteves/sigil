// Hidden verifier support: loads plain Kubernetes manifests and evaluates them the way the cluster
// would, offline. Every rule here is ported from Kubernetes v1.37.2 source, not from memory:
//   - Pod Security Standards "restricted" (staging/src/k8s.io/pod-security-admission/policy),
//   - the kubelet's runAsNonRoot check against the image user (pkg/kubelet/kuberuntime),
//   - PodDisruptionBudget status and the eviction subresource (pkg/controller/disruption,
//     pkg/registry/core/pod/storage/eviction.go),
//   - HPA request accounting (pkg/controller/podautoscaler/replica_calculator.go).
// Schema validation (unknown fields, wrong types, API versions that 1.37 no longer serves) is done
// by kubeconform with the v1.37.2 strict JSON schemas that setup downloaded and checksummed.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { parseAllDocuments } from 'yaml'

/* ---------------------------------------------------------------------------------------------- */
/* Loading                                                                                         */
/* ---------------------------------------------------------------------------------------------- */

function walk(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((e) => {
      const p = join(dir, e.name)
      if (e.isDirectory()) return e.name === 'node_modules' || e.name.startsWith('.') ? [] : walk(p)
      return /\.ya?ml$/.test(e.name) ? [p] : []
    })
}

/**
 * Every object in every YAML file under `dir` (recursive, like `kubectl apply -R -f`). Kubernetes
 * reads manifests with YAML 1.1 rules (sigs.k8s.io/yaml), so `0644` is octal and `on` is a boolean.
 */
export function loadManifests(root, dir = 'deploy/k8s') {
  const files = walk(join(root, dir))
  const objects = []
  const errors = []
  for (const file of files) {
    const rel = relative(root, file)
    const text = readFileSync(file, 'utf8')
    for (const doc of parseAllDocuments(text, { version: '1.1', uniqueKeys: true })) {
      if (doc.errors.length) {
        errors.push(`${rel}: ${doc.errors[0].message}`)
        continue
      }
      const value = doc.toJS({ maxAliasCount: 100 })
      if (value === null || value === undefined) continue
      const items = value.kind === 'List' && Array.isArray(value.items) ? value.items : [value]
      for (const obj of items) objects.push({ file: rel, obj })
    }
  }
  return { files: files.map((f) => relative(root, f)), objects, errors }
}

export const nameOf = (obj) => obj?.metadata?.name

/** Kinds whose objects contain a pod template, with the path to it. */
export function podTemplates(objects) {
  const out = []
  for (const { file, obj } of objects) {
    if (!obj || typeof obj !== 'object') continue
    let template
    switch (obj.kind) {
      case 'Pod':
        template = { metadata: obj.metadata, spec: obj.spec }
        break
      case 'Deployment':
      case 'ReplicaSet':
      case 'StatefulSet':
      case 'DaemonSet':
      case 'Job':
      case 'ReplicationController':
        template = obj.spec?.template
        break
      case 'CronJob':
        template = obj.spec?.jobTemplate?.spec?.template
        break
      case 'PodTemplate':
        template = obj.template
        break
      default:
        continue
    }
    out.push({
      file,
      kind: obj.kind,
      name: nameOf(obj),
      obj,
      metadata: template?.metadata ?? {},
      spec: template?.spec ?? {},
    })
  }
  return out
}

/** Init containers, containers and ephemeral containers, in the order PSA and the kubelet visit them. */
export function allContainers(spec) {
  return [
    ...(spec?.initContainers ?? []).map((c) => ({ ...c, _type: 'initContainers' })),
    ...(spec?.containers ?? []).map((c) => ({ ...c, _type: 'containers' })),
    ...(spec?.ephemeralContainers ?? []).map((c) => ({ ...c, _type: 'ephemeralContainers' })),
  ]
}

export const isSidecar = (c) => c._type === 'initContainers' && c.restartPolicy === 'Always'

/* ---------------------------------------------------------------------------------------------- */
/* Pod Security Standards, "restricted" at version "latest" (v1.37)                                */
/* ---------------------------------------------------------------------------------------------- */

const set = (...xs) => new Set(xs)
const isWindows = (spec) => spec?.os?.name === 'windows'
const relaxForUserNamespace = (spec) => spec?.hostUsers === false
const sc = (c) => c.securityContext ?? undefined

const SECCOMP_OK = set('RuntimeDefault', 'Localhost')
const APPARMOR_OK = set('RuntimeDefault', 'Localhost')
const SELINUX_TYPES = set('', 'container_t', 'container_init_t', 'container_kvm_t', 'container_engine_t')
const SYSCTLS_1_37 = set(
  'kernel.shm_rmid_forced',
  'net.ipv4.ip_local_port_range',
  'net.ipv4.tcp_syncookies',
  'net.ipv4.ping_group_range',
  'net.ipv4.ip_unprivileged_port_start',
  'net.ipv4.ip_local_reserved_ports',
  'net.ipv4.tcp_keepalive_time',
  'net.ipv4.tcp_fin_timeout',
  'net.ipv4.tcp_keepalive_intvl',
  'net.ipv4.tcp_keepalive_probes',
  'net.ipv4.tcp_rmem',
  'net.ipv4.tcp_wmem',
  'net.ipv4.tcp_slow_start_after_idle',
  'net.ipv4.tcp_notsent_lowat',
)
const RESTRICTED_VOLUME_SOURCES = [
  'configMap',
  'csi',
  'downwardAPI',
  'emptyDir',
  'ephemeral',
  'image',
  'persistentVolumeClaim',
  'projected',
  'secret',
]
const present = (v) => v !== undefined && v !== null

/**
 * Returns the violated controls (empty = admitted). Same decisions as the pod-security-admission
 * policy package at v1.37.2 evaluating level "restricted", version "latest", for a Linux or
 * Windows pod. Messages mirror the admission controller's wording.
 */
export function pssRestricted(metadata, spec) {
  const v = []
  const containers = allContainers(spec)
  const podSC = spec?.securityContext ?? {}
  const annotations = metadata?.annotations ?? {}
  const names = (cs) => cs.map((c) => `"${c.name}"`).join(', ')

  // Baseline: host namespaces.
  const hostNS = ['hostNetwork', 'hostPID', 'hostIPC'].filter((k) => spec?.[k] === true)
  if (hostNS.length) v.push(`host namespaces (${hostNS.map((k) => `${k}=true`).join(', ')})`)

  // Baseline: privileged.
  const priv = containers.filter((c) => sc(c)?.privileged === true)
  if (priv.length) v.push(`privileged (containers ${names(priv)} must not set securityContext.privileged=true)`)

  // Baseline: hostPorts.
  const hostPorts = containers.filter((c) => (c.ports ?? []).some((p) => present(p.hostPort) && p.hostPort !== 0))
  if (hostPorts.length) v.push(`hostPort (containers ${names(hostPorts)} use hostPorts)`)

  // Baseline (1.34+): host field in probes and lifecycle handlers.
  const hostOf = (h) => [h?.httpGet?.host, h?.tcpSocket?.host].filter((x) => typeof x === 'string' && x !== '')
  const probeHosts = containers.filter(
    (c) =>
      hostOf(c.livenessProbe).length ||
      hostOf(c.readinessProbe).length ||
      hostOf(c.startupProbe).length ||
      hostOf(c.lifecycle?.postStart).length ||
      hostOf(c.lifecycle?.preStop).length,
  )
  if (probeHosts.length) v.push(`probe or lifecycle host (containers ${names(probeHosts)})`)

  // Baseline: AppArmor fields and the deprecated annotations.
  const badAppArmor = []
  if (present(podSC.appArmorProfile) && !APPARMOR_OK.has(podSC.appArmorProfile.type)) badAppArmor.push('pod')
  for (const c of containers)
    if (present(sc(c)?.appArmorProfile) && !APPARMOR_OK.has(sc(c).appArmorProfile.type)) badAppArmor.push(c.name)
  for (const [k, val] of Object.entries(annotations))
    if (
      k.startsWith('container.apparmor.security.beta.kubernetes.io/') &&
      !(val === '' || val === 'runtime/default' || String(val).startsWith('localhost/'))
    )
      badAppArmor.push(`annotation ${k}`)
  if (badAppArmor.length) v.push(`forbidden AppArmor profile (${badAppArmor.join(', ')})`)

  // Baseline (1.31+): SELinux options.
  const badSELinux = (o) => present(o) && (!SELINUX_TYPES.has(o.type ?? '') || (o.user ?? '') !== '' || (o.role ?? '') !== '')
  const seBad = [
    ...(badSELinux(podSC.seLinuxOptions) ? ['pod'] : []),
    ...containers.filter((c) => badSELinux(sc(c)?.seLinuxOptions)).map((c) => c.name),
  ]
  if (seBad.length) v.push(`seLinuxOptions (${seBad.join(', ')})`)

  // Restricted (1.35+) procMount: overrides the baseline check, no user-namespace relaxation.
  const badProc = containers.filter((c) => present(sc(c)?.procMount) && sc(c).procMount !== 'Default')
  if (badProc.length) v.push(`procMount (containers ${names(badProc)} must not set securityContext.procMount)`)

  // Baseline (1.37 list): sysctls.
  const badSysctls = (podSC.sysctls ?? []).filter((s) => !SYSCTLS_1_37.has(s?.name)).map((s) => s?.name)
  if (badSysctls.length) v.push(`forbidden sysctls (${badSysctls.join(', ')})`)

  // Baseline: Windows HostProcess.
  const hp = [
    ...(podSC.windowsOptions?.hostProcess === true ? ['pod'] : []),
    ...containers.filter((c) => sc(c)?.windowsOptions?.hostProcess === true).map((c) => c.name),
  ]
  if (hp.length) v.push(`hostProcess (${hp.join(', ')})`)

  // Restricted: volume types (overrides the baseline hostPath check).
  const badVolumes = (spec?.volumes ?? []).filter((vol) => !RESTRICTED_VOLUME_SOURCES.some((k) => present(vol?.[k])))
  if (badVolumes.length)
    v.push(
      `restricted volume types (volumes ${badVolumes.map((x) => `"${x?.name}"`).join(', ')} use ${badVolumes
        .map((x) => Object.keys(x ?? {}).find((k) => k !== 'name') ?? 'no source')
        .join(', ')})`,
    )

  const windows = isWindows(spec)

  // Restricted (1.25+, Linux only): allowPrivilegeEscalation=false on every container.
  if (!windows) {
    const bad = containers.filter((c) => sc(c)?.allowPrivilegeEscalation !== false)
    if (bad.length)
      v.push(`allowPrivilegeEscalation != false (containers ${names(bad)} must set securityContext.allowPrivilegeEscalation=false)`)
  }

  // Restricted (1.35+): runAsNonRoot, relaxed for pods with hostUsers: false.
  if (!relaxForUserNamespace(spec)) {
    const podFalse = podSC.runAsNonRoot === false
    const podTrue = podSC.runAsNonRoot === true
    const explicit = containers.filter((c) => sc(c)?.runAsNonRoot === false)
    const implicit = containers.filter((c) => !present(sc(c)?.runAsNonRoot) && !podTrue)
    if (podFalse || explicit.length)
      v.push(`runAsNonRoot != true (${[podFalse ? 'pod' : '', explicit.length ? `containers ${names(explicit)}` : ''].filter(Boolean).join(' and ')} must not set securityContext.runAsNonRoot=false)`)
    else if (implicit.length)
      v.push(`runAsNonRoot != true (pod or containers ${names(implicit)} must set securityContext.runAsNonRoot=true)`)
  }

  // Restricted (1.35+): runAsUser != 0, relaxed for pods with hostUsers: false.
  if (!relaxForUserNamespace(spec)) {
    const bad = [
      ...(podSC.runAsUser === 0 ? ['pod'] : []),
      ...containers.filter((c) => sc(c)?.runAsUser === 0).map((c) => c.name),
    ]
    if (bad.length) v.push(`runAsUser=0 (${bad.join(', ')} must not set runAsUser=0)`)
  }

  // Restricted (1.25+, Linux only): seccompProfile RuntimeDefault or Localhost, set at pod level or on
  // every container. The removed seccomp annotations count for nothing.
  if (!windows) {
    const podSet = present(podSC.seccompProfile)
    const podOk = podSet && SECCOMP_OK.has(podSC.seccompProfile.type)
    const explicit = containers.filter((c) => present(sc(c)?.seccompProfile) && !SECCOMP_OK.has(sc(c).seccompProfile.type))
    const implicit = containers.filter((c) => !present(sc(c)?.seccompProfile) && !podOk)
    if ((podSet && !podOk) || explicit.length)
      v.push(`seccompProfile (${[podSet && !podOk ? 'pod' : '', explicit.length ? `containers ${names(explicit)}` : ''].filter(Boolean).join(' and ')} must not set securityContext.seccompProfile.type to an unconfined value)`)
    else if (implicit.length)
      v.push(`seccompProfile (pod or containers ${names(implicit)} must set securityContext.seccompProfile.type to "RuntimeDefault" or "Localhost")`)
  }

  // Restricted (1.25+, Linux only): drop ALL, add only NET_BIND_SERVICE. Comparison is
  // case-sensitive, like the admission controller.
  if (!windows) {
    const missingDrop = containers.filter((c) => !(sc(c)?.capabilities?.drop ?? []).includes('ALL'))
    const badAdd = containers.filter((c) => (sc(c)?.capabilities?.add ?? []).some((x) => x !== 'NET_BIND_SERVICE'))
    if (missingDrop.length) v.push(`unrestricted capabilities (containers ${names(missingDrop)} must set securityContext.capabilities.drop=["ALL"])`)
    if (badAdd.length) v.push(`unrestricted capabilities (containers ${names(badAdd)} must only add NET_BIND_SERVICE)`)
  }

  return v
}

/* ---------------------------------------------------------------------------------------------- */
/* Kubelet: effective security context and the runAsNonRoot image check                           */
/* ---------------------------------------------------------------------------------------------- */

/** Container fields override pod fields (pkg/securitycontext DetermineEffectiveSecurityContext). */
export function effectiveSecurityContext(spec, container) {
  const pod = spec?.securityContext ?? {}
  const c = container.securityContext ?? {}
  const pick = (k) => (present(c[k]) ? c[k] : pod[k])
  return {
    runAsUser: pick('runAsUser'),
    runAsGroup: pick('runAsGroup'),
    runAsNonRoot: pick('runAsNonRoot'),
    seccompProfile: pick('seccompProfile'),
    readOnlyRootFilesystem: c.readOnlyRootFilesystem,
    allowPrivilegeEscalation: c.allowPrivilegeEscalation,
    capabilities: c.capabilities,
    privileged: c.privileged,
  }
}

/** containerd's getUserFromImage: numeric (optionally "uid:gid") is a uid, anything else a name. */
export function parseImageUser(user) {
  if (user === undefined || user === null || user === '') return { uid: undefined, username: '' }
  const first = String(user).split(':')[0]
  return /^-?\d+$/.test(first) ? { uid: Number(first), username: '' } : { uid: undefined, username: first }
}

/**
 * The kubelet's verifyRunAsNonRoot. `imageUser` is the image config's User string ("" when the
 * image sets none, which the kubelet treats as uid 0). Returns an error message or undefined.
 */
export function kubeletRunAsNonRootError(spec, container, imageUser) {
  const eff = effectiveSecurityContext(spec, container)
  if (eff.runAsNonRoot !== true) return undefined
  if (present(eff.runAsUser)) {
    if (eff.runAsUser === 0) return `container's runAsUser breaks non-root policy (container: ${container.name})`
    return undefined
  }
  const { uid, username } = parseImageUser(imageUser)
  if (uid === undefined && username)
    return `container has runAsNonRoot and image has non-numeric user (${username}), cannot verify user is non-root (container: ${container.name})`
  const effectiveUid = uid ?? 0
  if (effectiveUid === 0) return `container has runAsNonRoot and image will run as root (container: ${container.name})`
  if (effectiveUid < 1 || effectiveUid > 2147483647)
    return `container has runAsNonRoot and image has an invalid user id (${effectiveUid}) (container: ${container.name})`
  return undefined
}

/* ---------------------------------------------------------------------------------------------- */
/* Dockerfile                                                                                      */
/* ---------------------------------------------------------------------------------------------- */

/** Final stage base image and the last USER in it (ARG defaults substituted). */
export function dockerfileFinalStage(text) {
  const lines = text
    .replace(/\\\r?\n/g, ' ')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
  const args = {}
  let stage
  for (const line of lines) {
    const m = line.match(/^(\w+)\s+(.*)$/)
    if (!m) continue
    const instr = m[1].toUpperCase()
    const rest = m[2].replace(/\$\{?(\w+)\}?/g, (all, k) => args[k] ?? all)
    if (instr === 'ARG') {
      const [k, ...val] = rest.split('=')
      if (!(k in args)) args[k.trim()] = val.join('=').replace(/^["']|["']$/g, '')
    } else if (instr === 'FROM') {
      const parts = rest.split(/\s+/).filter((p) => !p.startsWith('--'))
      stage = { from: parts[0], name: parts[2], user: '' }
    } else if (instr === 'USER' && stage) {
      stage.user = rest.trim()
    }
  }
  return stage
}

/* ---------------------------------------------------------------------------------------------- */
/* kubeconform                                                                                     */
/* ---------------------------------------------------------------------------------------------- */

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')

/** Fails loudly if the tools fetched during setup are missing or were modified. */
export function checkTools(root, expected) {
  const problems = []
  const bin = join(root, '.tools', 'kubeconform')
  if (!existsSync(bin)) problems.push('.tools/kubeconform is missing (setup did not run?)')
  else if (!expected.kubeconform.includes(sha256(bin))) problems.push('.tools/kubeconform does not match the pinned release')
  for (const [file, hash] of Object.entries(expected.schemas)) {
    const p = join(root, '.tools', 'schemas', file)
    if (!existsSync(p)) problems.push(`.tools/schemas/${file} is missing`)
    else if (sha256(p) !== hash) problems.push(`.tools/schemas/${file} does not match the pinned schema`)
  }
  return problems
}

// API groups that ship with Kubernetes. Objects in other groups are custom resources, which have
// no schema offline and are skipped by schema validation (semantic checks still see them).
const BUILTIN_GROUPS = set(
  '',
  'admissionregistration.k8s.io',
  'apiextensions.k8s.io',
  'apiregistration.k8s.io',
  'apps',
  'authentication.k8s.io',
  'authorization.k8s.io',
  'autoscaling',
  'batch',
  'certificates.k8s.io',
  'coordination.k8s.io',
  'discovery.k8s.io',
  'events.k8s.io',
  'extensions',
  'flowcontrol.apiserver.k8s.io',
  'networking.k8s.io',
  'node.k8s.io',
  'policy',
  'rbac.authorization.k8s.io',
  'resource.k8s.io',
  'scheduling.k8s.io',
  'storage.k8s.io',
  'storagemigration.k8s.io',
)
// Group versions served by a v1.37 API server with default settings (kubectl api-versions).
const SERVED_1_37 = set(
  'v1',
  'admissionregistration.k8s.io/v1',
  'apiextensions.k8s.io/v1',
  'apiregistration.k8s.io/v1',
  'apps/v1',
  'authentication.k8s.io/v1',
  'authorization.k8s.io/v1',
  'autoscaling/v1',
  'autoscaling/v2',
  'batch/v1',
  'certificates.k8s.io/v1',
  'coordination.k8s.io/v1',
  'discovery.k8s.io/v1',
  'events.k8s.io/v1',
  'flowcontrol.apiserver.k8s.io/v1',
  'networking.k8s.io/v1',
  'node.k8s.io/v1',
  'policy/v1',
  'rbac.authorization.k8s.io/v1',
  'resource.k8s.io/v1',
  'scheduling.k8s.io/v1',
  'storage.k8s.io/v1',
  'storagemigration.k8s.io/v1',
)
const groupOf = (apiVersion) => (String(apiVersion ?? '').includes('/') ? String(apiVersion).split('/')[0] : '')

/**
 * Validates every manifest file against the Kubernetes v1.37.2 strict schemas. Returns a list of
 * problems (empty = valid). Built-in API versions that 1.37 does not serve are always problems.
 */
export function schemaProblems(root, loaded) {
  const problems = [...loaded.errors]
  for (const { file, obj } of loaded.objects) {
    if (!obj || typeof obj !== 'object' || !obj.apiVersion || !obj.kind) {
      problems.push(`${file}: an object without apiVersion/kind`)
      continue
    }
    const group = groupOf(obj.apiVersion)
    if (BUILTIN_GROUPS.has(group) && !SERVED_1_37.has(obj.apiVersion))
      problems.push(`${file}: ${obj.kind} ${nameOf(obj)} uses apiVersion ${obj.apiVersion}, which Kubernetes 1.37 does not serve`)
  }
  if (loaded.files.length === 0) return [...problems, 'no manifests found']
  const bin = join(root, '.tools', 'kubeconform')
  const r = spawnSync(
    bin,
    [
      '-strict',
      '-output',
      'json',
      '-schema-location',
      join(root, '.tools', 'schemas', '{{ .ResourceKind }}{{ .KindSuffix }}.json'),
      ...loaded.files.map((f) => join(root, f)),
    ],
    { encoding: 'utf8', timeout: 30_000 },
  )
  let report
  try {
    report = JSON.parse(r.stdout)
  } catch {
    return [...problems, `kubeconform failed: ${r.stderr || r.stdout || r.error?.message}`]
  }
  for (const res of report.resources ?? []) {
    if (res.status === 'statusValid' || res.status === 'statusSkipped' || res.status === 'statusEmpty') continue
    const missingSchema = /could not find schema/.test(res.msg ?? '')
    const obj = loaded.objects.find((o) => o.file === relative(root, res.filename) && nameOf(o.obj) === res.name && o.obj.kind === res.kind)?.obj
    if (missingSchema && obj && (!BUILTIN_GROUPS.has(groupOf(obj.apiVersion)) || SERVED_1_37.has(obj.apiVersion))) continue
    problems.push(`${relative(root, res.filename)}: ${res.kind} ${res.name}: ${res.msg}`)
  }
  return problems
}

/* ---------------------------------------------------------------------------------------------- */
/* Label selectors                                                                                 */
/* ---------------------------------------------------------------------------------------------- */

/** metav1.LabelSelector semantics. An empty selector matches everything; a missing one nothing. */
export function selectorMatches(selector, labels = {}) {
  if (!selector) return false
  for (const [k, val] of Object.entries(selector.matchLabels ?? {})) if (labels[k] !== String(val)) return false
  for (const e of selector.matchExpressions ?? []) {
    const has = Object.hasOwn(labels, e.key)
    const values = (e.values ?? []).map(String)
    switch (e.operator) {
      case 'In':
        if (!has || !values.includes(labels[e.key])) return false
        break
      case 'NotIn':
        if (has && values.includes(labels[e.key])) return false
        break
      case 'Exists':
        if (!has) return false
        break
      case 'DoesNotExist':
        if (has) return false
        break
      default:
        return false
    }
  }
  return true
}

/* ---------------------------------------------------------------------------------------------- */
/* PodDisruptionBudget: controller status + eviction decision                                     */
/* ---------------------------------------------------------------------------------------------- */

/** intstr.GetScaledValueFromIntOrPercent with roundUp=true. */
function scaled(value, total) {
  if (typeof value === 'number') return value
  const m = String(value).match(/^(\d+)%$/)
  if (m) return Math.ceil((Number(m[1]) * total) / 100)
  if (/^\d+$/.test(String(value))) return Number(value)
  throw new Error(`invalid int-or-percent ${value}`)
}

/**
 * Simulates the disruption controller for `pods` ({ name, ready, phase }) owned by a workload with
 * `scale` replicas, then asks the eviction subresource whether `target` may be evicted.
 */
export function evictionAllowed(pdb, pods, scale, target) {
  const spec = pdb.spec ?? {}
  let expected
  let desired
  if (present(spec.maxUnavailable)) {
    expected = scale
    desired = Math.max(0, expected - scaled(spec.maxUnavailable, expected))
  } else if (present(spec.minAvailable)) {
    if (typeof spec.minAvailable === 'number') {
      desired = spec.minAvailable
      expected = pods.length
    } else {
      expected = scale
      desired = scaled(spec.minAvailable, expected)
    }
  } else {
    expected = scale
    desired = 0
  }
  const healthy = pods.filter((p) => p.phase === 'Running' && p.ready).length
  let allowed = healthy - desired
  if (expected <= 0 || allowed <= 0) allowed = 0

  const pod = pods.find((p) => p.name === target)
  if (['Succeeded', 'Failed', 'Pending'].includes(pod.phase)) return true
  if (!pod.ready) {
    if (spec.unhealthyPodEvictionPolicy === 'AlwaysAllow') return true
    if (healthy >= desired && desired > 0) return true
  }
  return allowed > 0
}

/* ---------------------------------------------------------------------------------------------- */
/* Volumes as the container sees them                                                              */
/* ---------------------------------------------------------------------------------------------- */

const norm = (p) => String(p).replace(/\/+$/, '') || '/'

/** The volume mount that serves `path` inside `container` (deepest mount wins), and the path inside the volume. */
export function mountFor(spec, container, path) {
  const target = norm(path)
  let best
  for (const m of container.volumeMounts ?? []) {
    const mp = norm(m.mountPath)
    const inside = target === mp ? '' : target.startsWith(`${mp}/`) ? target.slice(mp.length + 1) : undefined
    if (inside === undefined) continue
    if (m.subPath && inside !== '') continue // a subPath mount of a file has nothing below it
    if (!best || mp.length > norm(best.mount.mountPath).length) best = { mount: m, inside }
  }
  if (!best) return undefined
  const volume = (spec.volumes ?? []).find((v) => v?.name === best.mount.name)
  const inVolume = [best.mount.subPath, best.inside].filter(Boolean).join('/')
  return { mount: best.mount, volume, inVolume }
}

/** Where a file inside a configMap (or projected configMap) volume comes from: { configMap, key }. */
export function configMapFileSource(volume, inVolume) {
  const fromSource = (cm, rel) => {
    if (!cm?.name) return undefined
    if (Array.isArray(cm.items) && cm.items.length) {
      const item = cm.items.find((i) => norm(i.path) === norm(rel))
      return item ? { configMap: cm.name, key: item.key } : undefined
    }
    return rel && !rel.includes('/') ? { configMap: cm.name, key: rel } : undefined
  }
  if (volume?.configMap) return fromSource(volume.configMap, inVolume)
  if (volume?.projected) {
    for (const src of volume.projected.sources ?? []) {
      const hit = src?.configMap ? fromSource(src.configMap, inVolume) : undefined
      if (hit) return hit
    }
  }
  return undefined
}

/** True when `dir` is backed by a writable, pod-scoped scratch volume (emptyDir or generic ephemeral). */
export function writableScratch(spec, container, dir) {
  const hit = mountFor(spec, container, dir)
  if (!hit || hit.mount.readOnly === true || !hit.volume) return false
  return present(hit.volume.emptyDir) || present(hit.volume.ephemeral)
}

/** Literal value of an env var on a container (undefined for valueFrom or missing). */
export function envValue(container, name) {
  const e = (container.env ?? []).filter((x) => x?.name === name).at(-1)
  return e && typeof e.value === 'string' ? e.value : undefined
}

/**
 * The container's environment as far as it can be known from the manifests: `envFrom` ConfigMaps
 * defined in `objects` (with their prefix), overridden by literal `env` entries.
 */
export function containerEnv(container, objects) {
  const env = {}
  for (const src of container.envFrom ?? []) {
    const name = src?.configMapRef?.name
    const cm = objects.find((o) => o?.kind === 'ConfigMap' && o.metadata?.name === name)
    for (const [k, val] of Object.entries(cm?.data ?? {})) env[`${src.prefix ?? ''}${k}`] = String(val)
  }
  for (const e of container.env ?? []) {
    if (typeof e?.value === 'string') env[e.name] = e.value
    else if (e?.name) delete env[e.name]
  }
  return env
}

/* ---------------------------------------------------------------------------------------------- */
/* Misc                                                                                            */
/* ---------------------------------------------------------------------------------------------- */

/** Kubernetes quantity to a number in base units (cpu cores or bytes). */
export function quantity(q) {
  if (q === undefined || q === null) return undefined
  const s = String(q).trim()
  const m = s.match(/^([+-]?\d+(?:\.\d+)?)(m|k|M|G|T|P|E|Ki|Mi|Gi|Ti|Pi|Ei)?$/)
  if (!m) return Number.NaN
  const n = Number(m[1])
  const mult = {
    undefined: 1,
    m: 1e-3,
    k: 1e3,
    M: 1e6,
    G: 1e9,
    T: 1e12,
    P: 1e15,
    E: 1e18,
    Ki: 2 ** 10,
    Mi: 2 ** 20,
    Gi: 2 ** 30,
    Ti: 2 ** 40,
    Pi: 2 ** 50,
    Ei: 2 ** 60,
  }[m[2]]
  return n * mult
}

export function describe(list) {
  return list.map((x) => `  - ${x}`).join('\n')
}

