// Hidden verifier: a tag-triggered release workflow that publishes with npm trusted publishing
// (OIDC, no stored token) and follows the repository's documented Actions conventions.
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  actionName,
  actionRef,
  effectivePermissions,
  isFullSha,
  jobsOf,
  loadWorkflows,
  remoteUses,
  stepsOf,
  triggers,
  writeScopes,
} from './workflow-lib.mjs'

const root = process.cwd()
const here = new URL('.', import.meta.url).pathname
const SHAS = JSON.parse(readFileSync(join(here, 'action-shas.json'), 'utf8'))
const REPO = 'northwind-labs/unitwise'

const workflows = loadWorkflows(root)
const release = workflows.find((w) => w.file === 'release.yml')
const doc = release?.doc

const PUBLISH = /(^|[\s;&|(])npm\s+(stage\s+)?publish\b/m
const TESTS = /(^|[\s;&|(])(npm\s+(test|t|tst|run\s+test|run-script\s+test|it|cit|install-test|clean-install-test)\b|node\s+--test\b)/m

const runText = (step) => (typeof step.run === 'string' ? step.run : '')

function publishJobs() {
  return jobsOf(doc).filter(([, job]) => stepsOf(job).some((s) => PUBLISH.test(runText(s))))
}

/** GitHub's filter pattern syntax for branches/tags (*, **, ?, +, [..]). */
function globToRegExp(pattern) {
  let re = ''
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        re += '.*'
        i++
      } else re += '[^/]*'
    } else if (c === '?' || c === '+') re += c
    else if (c === '[') {
      const end = pattern.indexOf(']', i)
      re += pattern.slice(i, end + 1)
      i = end
    } else re += c.replace(/[.^$|(){}\\]/g, '\\$&')
  }
  return new RegExp(`^${re}$`)
}

function tagTriggers(name) {
  const push = triggers(doc).push
  if (!push) return false
  const tags = [].concat(push.tags ?? [])
  const ignore = [].concat(push['tags-ignore'] ?? [])
  if (tags.length === 0 && ignore.length === 0) return false
  let match = tags.length === 0
  for (const p of tags) {
    if (p.startsWith('!')) {
      if (globToRegExp(p.slice(1)).test(name)) match = false
    } else if (globToRegExp(p).test(name)) match = true
  }
  if (ignore.some((p) => globToRegExp(p).test(name))) match = false
  return match
}

const LTS = { iron: 20, jod: 22, krypton: 24 }

/** Lowest Node major the spec can resolve to, or Infinity for "newest" aliases. */
function nodeMajor(spec) {
  const s = String(spec ?? '').trim().toLowerCase()
  if (!s) return undefined
  if (['latest', 'current', 'node', 'lts/*'].includes(s)) return Number.POSITIVE_INFINITY
  const lts = /^lts\/(\w+)$/.exec(s)
  if (lts) return LTS[lts[1]] ?? Number.POSITIVE_INFINITY
  const open = /^>=?\s*v?(\d+)/.exec(s)
  if (open) return Number.POSITIVE_INFINITY // setup-node resolves an open range to the newest release
  const m = /^[~^v=]*\s*(\d+)/.exec(s)
  return m ? Number(m[1]) : undefined
}

function nodeVersionFromFile(file) {
  const p = join(root, file)
  if (!existsSync(p)) return undefined
  const text = readFileSync(p, 'utf8')
  if (file.endsWith('package.json')) {
    const pkg = JSON.parse(text)
    const dev = pkg.devEngines?.runtime
    const devVersion = Array.isArray(dev) ? dev.find((r) => r.name === 'node')?.version : dev?.version
    return devVersion ?? pkg.volta?.node ?? pkg.engines?.node
  }
  const line = text.split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('#'))
  return line?.replace(/^nodejs\s+|^node\s+/, '')
}

const UPGRADES_NPM = /\bnpm\s+(i|install|add)\s+(-g|--global)\s+(npm@(latest|next|1[2-9]|11(\.(x|[5-9]|[1-9]\d)|$|\s)|\^11\.([5-9]|[1-9]\d)|>=?\s*11\.([5-9]|[1-9]\d))|npm\s*$)/m

function npmIsRecentEnough(job) {
  const steps = stepsOf(job)
  const publishAt = steps.findIndex((s) => PUBLISH.test(runText(s)))
  const before = steps.slice(0, publishAt)
  if (before.some((s) => UPGRADES_NPM.test(runText(s)))) return { ok: true }
  const setups = before.filter((s) => actionName(s.uses) === 'actions/setup-node')
  if (setups.length === 0) return { ok: false, why: 'the publish job does not set up Node, so npm is whatever the runner image ships' }
  const w = setups[setups.length - 1].with ?? {}
  let spec = w['node-version']
  if (spec === undefined && w['node-version-file']) spec = nodeVersionFromFile(String(w['node-version-file']))
  if (typeof spec === 'string' && spec.includes('${{')) {
    const values = []
      .concat(Object.values(job.strategy?.matrix ?? {}))
      .flat()
      .filter((v) => typeof v !== 'object')
    const majors = values.map(nodeMajor)
    if (majors.length && majors.every((m) => m >= 24)) return { ok: true }
    return { ok: false, why: `node-version ${spec} can resolve to a release whose bundled npm is older than 11.5.1` }
  }
  const major = nodeMajor(spec)
  if (major === undefined) return { ok: false, why: `cannot tell which Node release "${spec}" is` }
  if (major >= 24) return { ok: true }
  return { ok: false, why: `Node ${spec} ships npm 10.x; trusted publishing needs npm 11.5.1 or later` }
}

function needsClosure(jobId, seen = new Set()) {
  const job = doc.jobs[jobId]
  for (const dep of [].concat(job?.needs ?? [])) {
    if (!seen.has(dep) && doc.jobs[dep]) {
      seen.add(dep)
      needsClosure(dep, seen)
    }
  }
  return seen
}

function jobRunsTests(job) {
  if (stepsOf(job).some((s) => TESTS.test(runText(s)))) return true
  if (typeof job.uses === 'string' && job.uses.startsWith('./')) {
    const called = workflows.find((w) => job.uses.endsWith(`/${w.file}`))
    if (!called?.doc || !('workflow_call' in triggers(called.doc))) return false
    return jobsOf(called.doc).some(([, j]) => stepsOf(j).some((s) => TESTS.test(runText(s))))
  }
  return false
}

function normaliseRepoUrl(repository) {
  const raw = typeof repository === 'string' ? repository : repository?.url
  if (typeof raw !== 'string') return undefined
  let s = raw.trim()
  if (/^[\w.-]+\/[\w.-]+$/.test(s)) s = `github:${s}`
  s = s
    .replace(/^git\+/, '')
    .replace(/^github:/, 'https://github.com/')
    .replace(/^git@github\.com:/, 'https://github.com/')
    .replace(/^(ssh:\/\/git@|git:\/\/|http:\/\/)github\.com\//, 'https://github.com/')
    .replace(/\.git$/, '')
    .replace(/\/$/, '')
  return s.toLowerCase()
}

test('there is a valid release.yml (the workflow file npm trusts)', () => {
  for (const w of workflows) assert.equal(w.error, undefined, `${w.file}: ${w.error}`)
  assert.ok(release, `npm's trusted publisher is configured for .github/workflows/release.yml; found ${workflows.map((w) => w.file).join(', ')}`)
})

test('it runs when a version tag is pushed, and only then', () => {
  assert.ok(doc)
  assert.ok(tagTriggers('v1.5.0'), 'pushing the tag v1.5.0 does not trigger the release workflow')
  const on = triggers(doc)
  assert.ok(!on.push?.branches && !on.push?.['branches-ignore'], 'pushes to branches would also publish')
  const risky = Object.keys(on).filter((e) => !['push', 'workflow_dispatch'].includes(e))
  assert.deepEqual(risky, [], `the release workflow also runs on ${risky.join(', ')}`)
})

test('it publishes with npm after the tests pass', () => {
  const jobs = publishJobs()
  assert.equal(jobs.length, 1, 'expected exactly one job that runs npm publish')
  const [jobId, job] = jobs[0]
  const steps = stepsOf(job)
  const publishAt = steps.findIndex((s) => PUBLISH.test(runText(s)))
  const testedHere = steps.slice(0, publishAt).some((s) => TESTS.test(runText(s)))
  const testedBefore = [...needsClosure(jobId)].some((dep) => jobRunsTests(doc.jobs[dep]))
  assert.ok(testedHere || testedBefore, 'npm publish can run without the tests having passed first')
})

test('publishing authenticates with OIDC, not a stored npm token', () => {
  const [jobId, job] = publishJobs()[0] ?? []
  assert.ok(job, 'no publish job')
  const perms = effectivePermissions(doc, job)
  assert.ok(perms.declared, `${jobId} inherits the repository's default token permissions`)
  assert.ok(perms.all === 'write' || perms.scopes['id-token'] === 'write', `${jobId} needs id-token: write to get an OIDC token`)
  const secrets = [...release.text.matchAll(/secrets\s*\.\s*([A-Za-z_][\w]*)|secrets\s*\[\s*'([^']+)'\s*\]/g)]
    .map((m) => m[1] ?? m[2])
    .filter((s) => s !== 'GITHUB_TOKEN')
  assert.deepEqual(secrets, [], 'the workflow reads stored secrets; trusted publishing needs none')
  assert.ok(!/_authToken/.test(release.text), 'the workflow writes an npm auth token')
  assert.ok(!/secrets\s*:\s*inherit/.test(release.text), 'secrets: inherit passes every secret along')
})

test('the publish job has an npm that supports trusted publishing', () => {
  const [, job] = publishJobs()[0] ?? []
  assert.ok(job, 'no publish job')
  const r = npmIsRecentEnough(job)
  assert.ok(r.ok, r.why)
})

test('publishing runs on a GitHub-hosted runner', () => {
  const [jobId, job] = publishJobs()[0] ?? []
  assert.ok(job, 'no publish job')
  const labels = [].concat(job['runs-on'] ?? [])
  const flat = labels.flatMap((l) => (typeof l === 'object' ? [].concat(l.labels ?? [], l.group ?? []) : [l]))
  assert.ok(flat.length > 0, `${jobId} has no runs-on`)
  assert.ok(!flat.some((l) => /self-hosted/i.test(String(l))), 'npm trusted publishing does not support self-hosted runners')
})

test('a GitHub release is created for the tag', () => {
  const creates = (step) =>
    /\bgh\s+release\s+create\b/.test(runText(step)) ||
    ['softprops/action-gh-release', 'ncipollo/release-action'].includes(actionName(step.uses)) ||
    (actionName(step.uses) === 'actions/github-script' && /createRelease|POST \/repos\/[^ ]+\/releases/.test(String(step.with?.script ?? '')))
  const jobs = jobsOf(doc).filter(([, job]) => stepsOf(job).some(creates))
  assert.ok(jobs.length > 0, 'nothing creates a GitHub release')
  for (const [jobId, job] of jobs) {
    const perms = effectivePermissions(doc, job)
    assert.ok(perms.declared && (perms.all === 'write' || perms.scopes.contents === 'write'), `${jobId} needs contents: write to create a release`)
  }
})

test('no job gets more token access than releasing needs', () => {
  for (const [jobId, job] of jobsOf(doc)) {
    const perms = effectivePermissions(doc, job)
    assert.ok(perms.declared, `${jobId} inherits the repository's default token permissions`)
    const extra = writeScopes(perms).filter((s) => !['id-token', 'contents', 'attestations', 'artifact-metadata'].includes(s))
    assert.deepEqual(extra, [], `${jobId} grants write access releasing does not use: ${extra.join(', ')}`)
  }
})

test('actions are pinned to full commit SHAs of real releases (CONTRIBUTING.md)', () => {
  const uses = remoteUses(doc)
  assert.ok(uses.length > 0)
  for (const { where, uses: u } of uses) {
    const ref = actionRef(u)
    assert.ok(isFullSha(ref), `${where}: ${u} is not pinned to a full commit SHA`)
    const action = u.split('@')[0].split('/').slice(0, 2).join('/')
    const known = SHAS[action] ?? SHAS[Object.keys(SHAS).find((k) => k.toLowerCase() === action.toLowerCase())]
    if (known) assert.ok(Object.values(known).includes(ref), `${where}: ${ref} is not a commit of any ${action} release`)
  }
})

test("package.json points at this repository, as npm's provenance check requires", () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  assert.equal(normaliseRepoUrl(pkg.repository), `https://github.com/${REPO}`, 'repository.url must match the GitHub repository that publishes')
  assert.equal(pkg.name, '@northwind/unitwise')
})
