// Hidden verifier: the npm token used to install @northwind/* from GitHub Packages must not be
// recoverable from anything the build publishes (image layers of every built stage, which the
// mode=max registry cache exports; the image config and history; the max-mode provenance, which
// records build-arg values in plain text), while the private packages still install in CI and
// locally through scripts/build-image.sh.
//
// The Dockerfile and the script are read statically and the build is simulated (dockerfile-lib.mjs):
// the token is a marker value that is traced through build args, ARG/ENV, secret mounts, npm's
// config files and every file a step writes.
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  analyzeBuildScript,
  buildContext,
  cleanPath,
  effectiveCommand,
  hasSecret,
  kubernetesNonRoot,
  parseDockerfile,
  reachableStages,
  resolveExecutable,
  secretValue,
  simulate,
} from './dockerfile-lib.mjs'

const root = process.cwd()
const TOKEN = secretValue('NPM_TOKEN')
const SCRIPT = 'scripts/build-image.sh'
const REGISTRY = 'https://npm.pkg.github.com'

const scriptText = readFileSync(join(root, SCRIPT), 'utf8')
const startEnv = { 0: SCRIPT, NPM_TOKEN: TOKEN, HOME: '/home/dev', PUSH: '1', PATH: '/usr/local/bin:/usr/bin:/bin' }
const script = analyzeBuildScript(scriptText, { env: startEnv, root })
const builds = script.builds.filter((b) => cleanPath(`${b.dir}/${b.context}`) === '.')
const build = builds[0]

function dockerfilePath(b) {
  return cleanPath(`${b.dir}/${b.dockerfile ?? `${b.context}/Dockerfile`}`)
}

/** Files the script writes inside the build context before building (e.g. a generated .npmrc). */
const scriptFilesInContext = [...script.files].filter(([p]) => !p.startsWith('/') && !p.startsWith('..'))
const tainted = new Set(scriptFilesInContext.filter(([, c]) => hasSecret(c)).map(([p]) => p))

function context() {
  const ctx = buildContext(root, { extra: ['.git/HEAD', '.git/config', ...scriptFilesInContext.map(([p]) => p)] })
  const overrides = new Map(scriptFilesInContext)
  const read = ctx.read
  ctx.read = (rel) => (overrides.has(rel) ? overrides.get(rel) : read(rel))
  return ctx
}

function secretsFor(b) {
  const out = {}
  for (const s of b.secrets) if (s.id) out[s.id] = s.value
  return out
}

let sim
let simError
if (build && existsSync(join(root, dockerfilePath(build)))) {
  try {
    sim = simulate(readFileSync(join(root, dockerfilePath(build)), 'utf8'), {
      context: context(),
      buildArgs: build.buildArgs,
      secrets: secretsFor(build),
      target: build.target,
      taintedContext: tainted,
    })
  } catch (e) {
    simError = e.message
  }
}
const stages = sim ? reachableStages(sim) : []
const final = sim?.final

test('scripts/build-image.sh still builds this repository with buildx', () => {
  assert.ok(builds.length > 0, `${SCRIPT} no longer runs docker build / docker buildx build for this repository`)
  assert.ok(existsSync(join(root, dockerfilePath(build))), `${dockerfilePath(build)} does not exist`)
  assert.equal(simError, undefined, `the Dockerfile does not parse: ${simError}`)
  assert.deepEqual(sim.errors.map((e) => `line ${e.line}: ${e.message}`), [], 'the build would fail')
})

test('it still publishes the same artifacts: both platforms, max provenance, SBOM, registry cache', () => {
  assert.ok(build, 'no build')
  const f = build.flags
  const platforms = (f['--platform'] ?? []).join(',')
  assert.ok(/linux\/amd64/.test(platforms) && /linux\/arm64/.test(platforms), 'the image must still be built for linux/amd64 and linux/arm64')
  const attest = (f['--attest'] ?? []).map(String)
  const provMax = (f['--provenance'] ?? []).some((v) => /mode=max/.test(String(v))) || attest.some((a) => /type=provenance/.test(a) && /mode=max/.test(a))
  assert.ok(provMax, 'the build must keep attaching max-mode provenance (--provenance=mode=max)')
  const sbom = (f['--sbom'] ?? []).some((v) => v === true || /^(true|1)$|generator=/.test(String(v))) || attest.some((a) => /type=sbom/.test(a))
  assert.ok(sbom, 'the build must keep attaching an SBOM (--sbom=true)')
  assert.ok((f['--cache-to'] ?? []).some((v) => /type=registry/.test(String(v)) && /mode=max/.test(String(v))), 'the build must keep exporting the registry cache with mode=max')
})

test('the token is never passed as a build argument, label or annotation', () => {
  assert.ok(build, 'no build')
  for (const b of builds) {
    const leaked = b.buildArgList.filter((a) => hasSecret(a.value)).map((a) => a.name)
    assert.deepEqual(leaked, [], `--build-arg ${leaked.join(', ')} carries the npm token: build-arg values are stored in plain text in the max-mode provenance attestation pushed with the image (and in docker history when a RUN in the final stage uses them)`)
    const meta = [...b.labels, ...b.annotations].filter(hasSecret)
    assert.deepEqual(meta, [], 'a label or annotation carries the npm token')
  }
})

test('no ARG, ENV or LABEL in any stage holds the token', () => {
  assert.ok(sim, 'no simulation')
  for (const s of stages) {
    const where = s.name ?? `stage ${s.index}`
    for (const a of s.args ?? []) assert.ok(!hasSecret(a.value), `${where}, line ${a.line}: ARG ${a.name} holds the npm token (build args are recorded in provenance and history; BuildKit flags this as SecretsUsedInArgOrEnv)`)
    for (const e of s.envs ?? []) assert.ok(!hasSecret(e.value), `${where}, line ${e.line}: ENV ${e.name} holds the npm token, so it is in the image config of that stage`)
    for (const [k, v] of Object.entries(s.config.labels)) assert.ok(!hasSecret(v), `${where}: LABEL ${k} holds the npm token`)
  }
})

test('no layer of any stage that gets built keeps the token', () => {
  assert.ok(sim, 'no simulation')
  for (const s of stages) {
    const where = s.name ?? `stage ${s.index}`
    for (const l of s.leaks)
      assert.fail(`${where}, line ${l.line}: ${l.how ?? 'a step'} leaves the token in ${l.path}. That layer is part of the build${s === final ? ' and the image' : ', and --cache-to mode=max pushes every intermediate layer to the public build cache'}; a later rm only hides it`)
  }
})

function northwindAuth(entry) {
  return (entry.auth ?? []).find((a) => a.scope === '@northwind')
}

function explainAuthFailure(entry) {
  const a = northwindAuth(entry)
  const rec = entry.record
  const at = `the npm install at line ${entry.line}`
  if (rec?.missingSecrets?.length) {
    const passed = build.secrets.map((s) => `${s.id} (${s.value === undefined ? `${s.how}: nothing there` : s.how})`)
    return `${at} mounts secret ${rec.missingSecrets.join(', ')}, but the build provides ${passed.length ? passed.join(', ') : 'no secrets'}`
  }
  if (rec?.unreadable?.length) return `${at} runs as user ${entry.user || 'root'} and cannot read ${rec.unreadable.join(', ')}: secret files are mode 0400 owned by root unless the mount sets uid/mode`
  if (!a) return `${at} has no @northwind registry configured, so npm looks for @northwind/money on registry.npmjs.org`
  if (a.unreadable?.length) return `${at} runs as user ${entry.user || 'root'} and cannot read ${a.unreadable.join(', ')}`
  if (a.token === undefined) return `${at} has no auth token for ${a.registry}`
  if (/\$\{[^}]+\}/.test(a.token)) return `${at}: ${a.tokenPath ?? 'npm config'} reads the token from ${a.token.match(/\$\{[^}]+\}/)[0]}, which is not set in that step, so npm sends the literal string and GitHub Packages answers 401`
  return `${at} authenticates to ${a.registry} with something other than the CI token`
}

test('the @northwind packages still install from GitHub Packages with the token', () => {
  assert.ok(final, 'no final stage')
  const nm = [...final.fs.entries].filter(([p, e]) => e.npm && p.endsWith('/node_modules'))
  assert.ok(nm.length > 0, 'the final image has no node_modules from an npm install')
  for (const [p, e] of nm) {
    const a = northwindAuth(e)
    const ok = a && a.registry.replace(/\/$/, '') === REGISTRY && hasSecret(a.token) && (a.unreadable?.length ?? 0) === 0 && !(e.record?.unreadable?.length)
    assert.ok(ok, `${p}: ${explainAuthFailure(e)}`)
  }
})

test('the image still runs the service the same way', () => {
  assert.ok(final, 'no final stage')
  const { argv } = effectiveCommand(final)
  const wd = final.config.workdir || '/'
  const exe = resolveExecutable(final, argv[0] ?? '')
  assert.ok(exe && /(^|\/)node$/.test(exe), `the container starts ${JSON.stringify(argv)}, expected node src/index.js`)
  const entry = argv.slice(1).find((a) => !a.startsWith('-'))
  assert.ok(entry && final.fs.exists(cleanPath(entry.startsWith('/') ? entry : `${wd}/${entry}`)) && /src\/index\.js$/.test(entry), `the container runs ${JSON.stringify(argv)}, which does not start src/index.js from the image`)
  const nmFor = cleanPath(`${wd}/node_modules`)
  assert.ok(final.fs.exists(nmFor) || final.fs.exists('/node_modules'), `src/index.js resolves its dependencies from ${nmFor}, which is missing`)
  const user = kubernetesNonRoot(final.config.user)
  assert.ok(user.ok, `the image must keep running as a non-root numeric user: ${user.why}`)
})

test('the Dockerfile itself never contains a token', () => {
  const text = readFileSync(join(root, dockerfilePath(build ?? { dir: '.', context: '.' })), 'utf8')
  assert.ok(!/(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|npm_[A-Za-z0-9]{30,})/.test(text), 'a literal token is written into the Dockerfile')
  parseDockerfile(text)
})
