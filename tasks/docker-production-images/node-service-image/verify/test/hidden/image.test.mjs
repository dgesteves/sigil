// Hidden verifier: a production Dockerfile for tally-api. The Dockerfile and .dockerignore are read
// statically and the build is simulated (dockerfile-lib.mjs) to find what the final stage contains
// and how it starts; the HEALTHCHECK and the start command are then run for real against the
// service compiled from this repo, with the final stage's environment and working directory.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, test } from 'node:test'
import {
  buildContext,
  cleanPath,
  effectiveCommand,
  flagValue,
  kubernetesNonRoot,
  parseImageRef,
  reachableStages,
  resolveExecutable,
  simulate,
  splitShell,
  evalShellWord,
} from './dockerfile-lib.mjs'

const root = process.cwd()
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const devDeps = Object.keys(pkg.devDependencies ?? {})
const tsconfig = JSON.parse(readFileSync(join(root, 'tsconfig.json'), 'utf8'))
const outDir = cleanPath(tsconfig.compilerOptions?.outDir ?? 'dist')
const work = mkdtempSync(join(tmpdir(), 'tally-verify-'))
after(() => rmSync(work, { recursive: true, force: true }))

// Compile the current sources once; the simulated `npm run build` output maps to these files.
const built = join(work, 'built')
const tsc = spawnSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.json', '--outDir', built], { cwd: root, encoding: 'utf8' })

/** Approved images and digests from CONTRIBUTING.md. */
const approved = [...readFileSync(join(root, 'CONTRIBUTING.md'), 'utf8').matchAll(/^\|\s*`([^`]+)`\s*\|\s*`(sha256:[0-9a-f]{64})`/gm)].map((m) => ({ ref: parseImageRef(m[1]), digest: m[2] }))

const VIRTUAL = ['.git/HEAD', '.git/config', '.git/objects/pack/pack-1.pack', '.env', '.env.local', 'dist/server.js', 'coverage/lcov.info', 'node_modules/pino/package.json', 'node_modules/typescript/package.json']
const ctx = buildContext(root, { extra: VIRTUAL })

const generatedHas = (entry, sub) => {
  if (entry.origin?.kind === 'build') return existsSync(join(built, sub))
  if (entry.npm) {
    if (sub === '.bin/tsc' || sub.startsWith('.bin/tsc')) return entry.dev
    const name = sub.startsWith('@') ? sub.split('/').slice(0, 2).join('/') : sub.split('/')[0]
    if (devDeps.includes(name) || name === 'typescript' || name.startsWith('@types/')) return entry.dev
    return existsSync(join(root, 'node_modules', sub)) || !sub.includes('/')
  }
  return true
}

let sim
let simError
try {
  sim = simulate(readFileSync(join(root, 'Dockerfile'), 'utf8'), { context: ctx, tsOutDir: outDir, generatedHas })
} catch (e) {
  simError = e.message
}
const final = sim?.final
const stages = sim ? reachableStages(sim) : []
const imageOf = (s) => (s?.parent ? imageOf(s.parent) : s?.baseRef)

test('the Dockerfile builds', () => {
  assert.equal(tsc.status, 0, `the TypeScript build fails:\n${tsc.stdout}${tsc.stderr}`)
  assert.equal(simError, undefined, `the Dockerfile does not parse: ${simError}`)
  assert.deepEqual(sim.errors.map((e) => `line ${e.line}: ${e.message}`), [], 'the build would fail')
})

test('the build context leaves out .git, local env files, node_modules, build output and coverage', () => {
  assert.ok(existsSync(join(root, '.dockerignore')), 'there is no .dockerignore, so `COPY . .` sends everything')
  for (const p of ['.git/HEAD', '.git/config', '.env', '.env.local', 'node_modules/pino/package.json', 'dist/server.js', 'coverage/lcov.info'])
    assert.ok(ctx.excluded(p), `.dockerignore does not exclude ${p}`)
})

test('base images are approved and pinned by tag and digest (CONTRIBUTING.md)', () => {
  assert.ok(sim, 'no simulation')
  assert.ok(approved.length >= 5, 'could not read the approved image table')
  const pulls = []
  for (const s of sim.stages) if (!s.parent && s.baseRef !== 'scratch') pulls.push({ ref: s.baseRef, where: `FROM on line ${s.line}` })
  for (const s of sim.stages)
    for (const ins of s.instructions) {
      const from = ins.cmd === 'COPY' || ins.cmd === 'ADD' ? flagValue(ins, 'from') : undefined
      if (from && !sim.stages.some((x) => x.name === from.toLowerCase() || String(x.index) === from)) pulls.push({ ref: from, where: `COPY --from on line ${ins.line}` })
    }
  for (const { ref, where } of pulls) {
    const r = parseImageRef(ref)
    assert.ok(r.tag && r.digest, `${where}: ${ref} must be pinned by tag and digest`)
    const ok = approved.some((a) => a.ref.name === r.name && a.digest === r.digest && a.ref.tag === r.tag)
    assert.ok(ok, `${where}: ${ref} is not one of the approved images with its listed digest`)
  }
})

test('the runtime image has no build tools and no devDependencies', () => {
  assert.ok(final, 'no final stage')
  assert.notEqual(final.base.toolchain, true, `the final stage is based on ${imageOf(final)}, which ships gcc, make, python3 and git; use a slim, alpine or distroless runtime`)
  assert.deepEqual(final.installedToolchain ?? [], [], 'the final stage installs build tools')
  const nm = [...final.fs.entries].filter(([, e]) => e.npm)
  assert.ok(nm.length > 0, 'the final image has no node_modules, but dist/server.js needs pino at runtime')
  for (const [p, e] of nm) assert.equal(e.dev, false, `${p} comes from \`${e.how}\` (line ${e.line}), so TypeScript and @types/node ship in the image`)
  for (const [p, e] of final.fs.entries) {
    if (e.origin?.kind === 'context' && /^node_modules\//.test(e.origin.rel)) assert.fail(`${p} is the developer's node_modules copied from the build context`)
  }
})

test('it runs as a numeric non-root user, as runAsNonRoot requires', () => {
  assert.ok(final, 'no final stage')
  const r = kubernetesNonRoot(final.config.user)
  assert.ok(r.ok, r.why)
})

function startCommand() {
  const eff = effectiveCommand(final)
  return eff
}

test('node is PID 1 (or an init that forwards signals), so SIGTERM reaches the shutdown handler', () => {
  assert.ok(final, 'no final stage')
  const eff = startCommand()
  if (eff.missing) assert.fail(`the container starts ${eff.missing}, which is not in the image`)
  if (eff.shellForm)
    assert.fail(`the container starts ${JSON.stringify([eff.pid1, '-c', eff.script])}: PID 1 is the shell (${eff.shellKind}), which does not forward SIGTERM to node, so the handler never runs and the pod is killed after the grace period. Use the exec (JSON) form`)
  const exe = resolveExecutable(final, eff.argv[0] ?? '')
  const base = (eff.argv[0] ?? '').split('/').at(-1)
  if (base === 'npm' || base === 'yarn' || base === 'pnpm') {
    const script = pkg.scripts?.[eff.argv.find((a, i) => i > 0 && !a.startsWith('-') && a !== 'run')]
    const simple = script && splitShell(script).length === 1
    assert.ok(final.base.shell === 'busybox' && simple, `PID 1 is ${base}, which runs the start script through /bin/sh (dash on Debian images): SIGTERM never reaches node. Start node directly`)
    return
  }
  assert.ok(exe && /(^|\/)node$/.test(exe), `the container's main process is ${JSON.stringify(eff.argv)}, not node`)
  const sig = final.config.stopsignal
  assert.ok(!sig || /^(SIGTERM|TERM|15|SIGINT|INT|2)$/i.test(sig), `STOPSIGNAL ${sig} is not a signal the server handles`)
})

/**
 * A directory laid out like the image for the files that came from this repo: context files and the
 * compiled output are copied, node_modules is linked to the installed tree.
 */
function mirror() {
  const dir = join(work, 'image')
  if (existsSync(dir)) return dir
  for (const [p, e] of final.fs.entries) {
    const target = join(dir, p)
    if (existsSync(target)) continue
    if (e.origin?.kind === 'context' && existsSync(join(root, e.origin.rel))) {
      mkdirSync(dirname(target), { recursive: true })
      cpSync(join(root, e.origin.rel), target)
    } else if (e.origin?.kind === 'build') {
      cpSync(built, target, { recursive: true })
    } else if (e.npm) {
      mkdirSync(dirname(target), { recursive: true })
      symlinkSync(join(root, 'node_modules'), target)
    }
  }
  mkdirSync(join(dir, final.config.workdir || '/'), { recursive: true })
  return dir
}

/** Runs image paths on the verifier: node is this node, files from the repo come from the mirror. */
function mapArg(arg, img) {
  if (arg === 'node' || /^\/(usr\/local\/bin|usr\/bin|bin|nodejs\/bin)\/node$/.test(arg)) return process.execPath
  if (!arg.startsWith('/')) return arg
  const owner = final.fs.owner(arg)
  const fromRepo = owner && (['context', 'build'].includes(owner.entry.origin?.kind) || owner.entry.npm)
  if (fromRepo) return join(img, arg)
  if (final.fs.exists(arg) && !existsSync(arg)) return arg.split('/').at(-1)
  return arg
}

function imageEnv() {
  const env = { ...process.env, ...final.config.env }
  env.PATH = process.env.PATH
  return env
}

const port = () => Number(final.config.env.PORT ?? 8080)

async function waitHealthy(ms) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    try {
      if ((await fetch(`http://127.0.0.1:${port()}/healthz`)).ok) return true
    } catch {}
    await new Promise((r) => setTimeout(r, 100))
  }
  return false
}

function runHealthcheck(img) {
  const test = final.config.healthcheck.test
  const cwd = join(img, final.config.workdir || '/')
  const opts = { cwd, env: imageEnv(), encoding: 'utf8', timeout: 15_000 }
  if (test[0] === 'CMD-SHELL') {
    const script = test[1].replaceAll(`${final.config.workdir}/`, `${cwd}/`)
    return spawnSync('/bin/sh', ['-c', script], opts)
  }
  const [cmd, ...args] = test.slice(1)
  return spawnSync(mapArg(cmd, img), args.map((a) => mapArg(a, img)), opts)
}

test('the HEALTHCHECK checks GET /healthz with tools that exist in the image', async () => {
  assert.ok(final, 'no final stage')
  const hc = final.config.healthcheck
  assert.ok(hc && hc.test[0] !== 'NONE', 'the final image has no HEALTHCHECK')
  const wd = final.config.workdir || '/'
  if (hc.test[0] === 'CMD-SHELL') {
    const sh = final.config.shell[0]
    assert.ok(resolveExecutable(final, sh), `HEALTHCHECK uses the shell form, but ${sh} does not exist in ${imageOf(final)}`)
    for (const c of splitShell(hc.test[1])) {
      const w = evalShellWord(c.words[0] ?? '', final.config.env)
      if (!w || ['exit', 'test', '[', 'true', 'false', 'echo', 'printf', ':', 'exec', 'then', 'fi', 'if', 'else'].includes(w)) continue
      assert.ok(resolveExecutable(final, w, wd), `the HEALTHCHECK runs ${w}, which is not in the final image (${imageOf(final)})`)
    }
  } else {
    const cmd = hc.test[1]
    assert.ok(resolveExecutable(final, cmd ?? '', wd), `the HEALTHCHECK runs ${cmd}, which is not in the final image (${imageOf(final)})`)
  }
  const eff = startCommand()
  const img = mirror()
  const exe = eff.argv[0]
  assert.ok(exe, 'no start command')
  const app = spawn(mapArg(exe, img), eff.argv.slice(1).map((a) => mapArg(a, img)), { cwd: join(img, wd), env: imageEnv(), stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  app.stdout.on('data', (d) => (out += d))
  app.stderr.on('data', (d) => (out += d))
  try {
    assert.ok(await waitHealthy(8000), `the image's command ${JSON.stringify(eff.argv)} did not serve /healthz on port ${port()}:\n${out.slice(-800)}`)
    const up = runHealthcheck(img)
    assert.equal(up.status, 0, `the HEALTHCHECK fails while the service is healthy (exit ${up.status}):\n${(up.stdout ?? '') + (up.stderr ?? '')}`)
  } finally {
    app.kill('SIGTERM')
    await new Promise((r) => (app.exitCode === null ? app.once('exit', r) : r()))
  }
  const down = runHealthcheck(img)
  assert.notEqual(down.status, 0, 'the HEALTHCHECK still passes with the service stopped, so it does not check anything')
})

test('changing a source file does not invalidate the dependency install', () => {
  assert.ok(sim, 'no simulation')
  const installs = stages.flatMap((s) => s.installs.map((i) => ({ ...i, stage: s })))
  assert.ok(installs.length > 0, 'no npm install found in the build')
  for (const i of installs) {
    const src = [...i.deps].filter((d) => /^(src|test)\//.test(d) || d === 'README.md')
    assert.deepEqual(src, [], `the npm install on line ${i.line} comes after copying ${src.slice(0, 3).join(', ')}${src.length > 3 ? '...' : ''}, so every source edit reinstalls all dependencies. Copy package.json and package-lock.json first`)
  }
})
