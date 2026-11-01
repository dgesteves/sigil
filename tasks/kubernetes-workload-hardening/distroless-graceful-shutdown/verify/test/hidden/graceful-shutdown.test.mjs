// Hidden verifier: a terminating ledger-api pod keeps accepting new requests for at least 10 s
// (endpoint removal lag at ingress-nginx and kube-proxy), lets accepted requests (exports up to 45 s)
// finish inside terminationGracePeriodSeconds, and the runtime image stays distroless.
//
// The kubelet's termination sequence is simulated against the real app:
//   1. the preStop hook runs to completion (sleep: its seconds; exec: the command really runs, but
//      only if its executable exists in the distroless image, which has no shell and no coreutils;
//      httpGet: a real request to the app);
//   2. SIGTERM is sent to the app, which is probed with fresh connections until it stops accepting;
//   3. the grace period must cover the hook, the app's own drain delay and a 45 s export.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { get } from 'node:http'
import { createServer } from 'node:net'
import { join, posix } from 'node:path'
import { test } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { checkTools, describe, dockerfileFinalStage, envValue, loadManifests, podTemplates, schemaProblems } from './k8s-lib.mjs'

const root = process.cwd()
const here = new URL('.', import.meta.url).pathname
const TOOLS = JSON.parse(readFileSync(join(here, 'tools.json'), 'utf8'))
const loaded = loadManifests(root)
const deployment = podTemplates(loaded.objects).find((t) => t.kind === 'Deployment' && t.name === 'ledger-api')
const container = (deployment?.spec.containers ?? []).find((c) => String(c.image).startsWith('ghcr.io/ledgerline/ledger-api:'))

const LB_LAG_SECONDS = 10
const LONGEST_REQUEST_SECONDS = 45

// gcr.io/distroless/nodejs24-debian13:nonroot, listed from the image filesystem: the only
// executable is the node binary, nothing lives in the PATH directories.
const IMAGE = {
  entrypoint: ['/nodejs/bin/node'],
  cmd: ['src/server.js'],
  workdir: '/app',
  path: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
  executables: new Set(['/nodejs/bin/node']),
}
const NODE = '/nodejs/bin/node'

/** Image path -> path in this checkout (the Dockerfile copies the repo to /app). */
const toRepo = (p) => (p === '/app' ? root : p.startsWith('/app/') ? join(root, p.slice(5)) : undefined)

/** Executable lookup as runc does it: names without a slash are searched in PATH. */
function resolveExecutable(argv0, envPath) {
  const candidates = argv0.includes('/')
    ? [posix.normalize(posix.isAbsolute(argv0) ? argv0 : posix.join(container?.workingDir ?? IMAGE.workdir, argv0))]
    : (envPath ?? IMAGE.path).split(':').map((d) => posix.join(d, argv0))
  for (const c of candidates) {
    if (IMAGE.executables.has(c)) return { node: true }
    const local = toRepo(c)
    // A script copied from the repo runs only if it is executable and starts with a node shebang.
    if (local && existsSync(local) && statSync(local).mode & 0o111) {
      const first = readFileSync(local, 'utf8').split('\n')[0]
      if (first.startsWith(`#!${NODE}`)) return { node: true, script: local }
    }
  }
  return undefined
}

const mapArg = (a) => (typeof a === 'string' && (a === '/app' || a.startsWith('/app/')) ? toRepo(a) : String(a))

function literalEnv(c) {
  const env = {}
  for (const e of c?.env ?? []) if (typeof e?.value === 'string') env[e.name] = e.value
  return env
}

function hookOf(c) {
  const h = c?.lifecycle?.preStop
  if (!h) return { kind: 'none' }
  if (h.sleep) return { kind: 'sleep', seconds: Number(h.sleep.seconds) }
  if (h.exec) return { kind: 'exec', argv: (h.exec.command ?? []).map(String) }
  if (h.httpGet) return { kind: 'httpGet', ...h.httpGet }
  return { kind: 'unsupported' } // tcpSocket is deprecated and the kubelet refuses to run it
}

/** Runs an exec preStop hook the way it would run inside the distroless container. */
function runExecHook(argv) {
  if (!argv.length) return { seconds: 0, note: 'empty exec command' }
  const exe = resolveExecutable(argv[0], envValue(container, 'PATH'))
  if (!exe)
    return {
      seconds: 0,
      note: `exec preStop "${argv.join(' ')}": "${argv[0]}" does not exist in the distroless runtime image, so the hook fails immediately (FailedPreStopHook) and SIGTERM follows at once`,
    }
  const args = [...(exe.script ? [exe.script] : []), ...argv.slice(1).map(mapArg)]
  const cwd = toRepo(container?.workingDir ?? IMAGE.workdir) ?? root
  const started = performance.now()
  spawnSync(process.execPath, args, { cwd, env: { ...process.env, ...literalEnv(container) }, timeout: 40_000, stdio: 'ignore' })
  return { seconds: (performance.now() - started) / 1000 }
}

const freePort = () =>
  new Promise((resolve) => {
    const s = createServer()
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address()
      s.close(() => resolve(port))
    })
  })

/** One request on a fresh connection. Resolves { status, body } or { error }. */
function request(port, path, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const req = get({ host: '127.0.0.1', port, path, agent: false, headers: { connection: 'close' } }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (d) => {
        body += d
      })
      res.on('end', () => resolve({ status: res.statusCode, body }))
      res.on('error', (error) => resolve({ error, body }))
    })
    req.on('error', (error) => resolve({ error }))
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')))
  })
}

async function simulate() {
  const hook = hookOf(container)
  const result = { hook, hookSeconds: 0, notes: [] }

  const argv = [...(container.command ?? IMAGE.entrypoint), ...(container.args ?? (container.command ? [] : IMAGE.cmd))]
  const exe = resolveExecutable(argv[0], envValue(container, 'PATH'))
  assert.ok(exe, `the container command ${JSON.stringify(argv)} cannot start in the distroless image`)
  const port = await freePort()
  const appPorts = new Set((container.ports ?? []).flatMap((p) => [p.containerPort, p.name]))
  const child = spawn(process.execPath, [...(exe.script ? [exe.script] : []), ...argv.slice(1).map(mapArg)], {
    cwd: toRepo(container.workingDir ?? IMAGE.workdir) ?? root,
    env: { ...process.env, ...literalEnv(container), PORT: String(port), EXPORT_ROW_DELAY_MS: '100' },
    stdio: 'ignore',
  })
  const exited = new Promise((resolve) => child.on('exit', () => resolve(performance.now())))
  try {
    let ready = false
    for (let i = 0; i < 100 && !ready; i++) {
      ready = (await request(port, '/readyz', 500)).status === 200
      if (!ready) await sleep(100)
    }
    assert.ok(ready, 'the app did not become ready')

    if (hook.kind === 'sleep') result.hookSeconds = hook.seconds
    else if (hook.kind === 'exec') {
      const h = runExecHook(hook.argv)
      result.hookSeconds = h.seconds
      if (h.note) result.notes.push(h.note)
    }
    else if (hook.kind === 'httpGet') {
      const target = appPorts.has(hook.port) ? port : 1 // anything else is not served by the app
      const started = performance.now()
      await request(target, hook.path ?? '/', 40_000)
      result.hookSeconds = (performance.now() - started) / 1000
    } else if (hook.kind === 'unsupported') result.notes.push('the preStop handler type is not run by the kubelet')

    // An export that is in flight when SIGTERM arrives (3 s at the throttle used here).
    const inflight = request(port, '/accounts/acc_ops/export?rows=30', 30_000)
    await sleep(200)
    const sigterm = performance.now()
    child.kill('SIGTERM')
    let appSeconds = 30
    for (;;) {
      const r = await request(port, '/readyz', 1000)
      const elapsed = (performance.now() - sigterm) / 1000
      if (r.status === undefined) {
        appSeconds = elapsed
        break
      }
      if (elapsed >= 30) break
      await sleep(100)
    }
    result.appSeconds = appSeconds
    result.inflight = await inflight
    const exitAt = await Promise.race([exited, sleep(15_000, undefined, { ref: false }).then(() => undefined)])
    result.exitSeconds = exitAt === undefined ? undefined : (exitAt - sigterm) / 1000
  } finally {
    child.kill('SIGKILL')
  }
  return result
}

let cached
const sim = () => {
  cached ??= simulate()
  return cached
}

test('manifests validate against the Kubernetes 1.37 API (strict schemas)', () => {
  assert.deepEqual(checkTools(root, TOOLS), [], 'the pinned validator from setup is missing or modified')
  const problems = schemaProblems(root, loaded)
  assert.deepEqual(problems, [], `schema validation failed:\n${describe(problems)}`)
})

test('the runtime image is still the distroless Node image', () => {
  const stage = dockerfileFinalStage(readFileSync(join(root, 'Dockerfile'), 'utf8'))
  assert.ok(stage?.from?.startsWith('gcr.io/distroless/nodejs24-debian13:nonroot'), `final stage is ${stage?.from}`)
  assert.ok(deployment, 'Deployment ledger-api is missing')
  assert.ok(container, 'the ledger-api container (image ghcr.io/ledgerline/ledger-api) is missing')
})

test(`a terminating pod keeps accepting new requests for at least ${LB_LAG_SECONDS} s`, async () => {
  const r = await sim()
  const total = r.hookSeconds + r.appSeconds
  assert.ok(
    total >= LB_LAG_SECONDS - 0.25,
    [
      `new requests are refused ${total.toFixed(1)} s after the pod starts terminating`,
      `(preStop ${r.hook.kind}: ${r.hookSeconds.toFixed(1)} s, then the app stops accepting ${r.appSeconds.toFixed(1)} s after SIGTERM),`,
      `but ingress-nginx and kube-proxy keep routing to it for up to ${LB_LAG_SECONDS} s.`,
      ...r.notes,
    ].join(' '),
  )
})

test('requests accepted before shutdown finish, and the app exits on its own', async () => {
  const r = await sim()
  const lines = (r.inflight.body ?? '').trim().split('\n')
  assert.ok(!r.inflight.error && r.inflight.status === 200 && lines.length === 31, `an in-flight export was cut off (${r.inflight.error?.message ?? `${lines.length - 1} of 30 rows`})`)
  assert.ok(r.exitSeconds !== undefined, 'the app never exits after SIGTERM, so every shutdown ends in SIGKILL')
})

test(`terminationGracePeriodSeconds covers the drain delay plus a ${LONGEST_REQUEST_SECONDS} s export`, async () => {
  const r = await sim()
  const grace = deployment.spec.terminationGracePeriodSeconds ?? 30
  const needed = r.hookSeconds + r.appSeconds + LONGEST_REQUEST_SECONDS
  assert.ok(
    grace >= needed - 1,
    `terminationGracePeriodSeconds is ${grace}, but an export accepted just before the pod stops accepting needs ${Math.ceil(needed - 1)} s; it would be SIGKILLed mid-download`,
  )
})

