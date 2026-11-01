// Hidden verifier: PR triage works again for pull requests from forks, without ever running the
// fork's code or splicing its text into scripts while holding a write token.
import assert from 'node:assert/strict'
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  actionRef,
  describeRun,
  effectivePermissions,
  freshDir,
  injectionSinks,
  jobsOf,
  loadWorkflows,
  pwnedFiles,
  simulate,
  triggers,
  untrustedCheckouts,
  writeScopes,
} from './workflow-lib.mjs'

const root = process.cwd()
const here = new URL('.', import.meta.url).pathname
const REPOSITORY = 'tidepool-dev/tidepool'
const PR = 42
const SHAS = JSON.parse(readFileSync(join(here, 'action-shas.json'), 'utf8'))

const privileged = () =>
  loadWorkflows(root).filter((w) => {
    if (!w.doc) return false
    const on = triggers(w.doc)
    return 'pull_request_target' in on || 'workflow_run' in on
  })

/** Version for a pinned SHA or tag, from the real tags of the action. */
function versionOf(action, ref) {
  const tags = SHAS[action] ?? {}
  if (/^[0-9a-f]{40}$/.test(ref ?? '')) {
    const hits = Object.entries(tags)
      .filter(([, sha]) => sha === ref)
      .map(([t]) => t)
    return hits.sort((a, b) => b.split('.').length - a.split('.').length)[0]
  }
  if (!ref) return undefined
  if (tags[ref]) {
    const full = Object.entries(tags).find(([t, sha]) => sha === tags[ref] && t.split('.').length === 3)
    return full ? full[0] : ref
  }
  return undefined
}

/** What a malicious fork puts in the PR: every script and npm script plants a marker file. */
function forkFiles(pwned) {
  const payload = `require('node:fs').writeFileSync(${JSON.stringify(join(pwned, 'fork-code-ran'))}, 'x')`
  return (dir) => {
    const walk = (d) => {
      for (const name of readdirSync(d)) {
        const p = join(d, name)
        if (statSync(p).isDirectory()) walk(p)
        else if (/\.(mjs|js|cjs)$/.test(name))
          writeFileSync(p, name.endsWith('.mjs') ? `import { createRequire } from 'node:module'\nconst require = createRequire(import.meta.url)\n${payload}\n` : `${payload}\n`)
        else if (name.endsWith('.sh')) writeFileSync(p, `touch ${join(pwned, 'fork-code-ran')}\n`)
      }
    }
    walk(dir)
    mkdirSync(join(dir, 'scripts'), { recursive: true })
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    pkg.scripts = Object.fromEntries(
      ['test', 'build', 'prepare', 'postinstall', 'label', ...Object.keys(pkg.scripts ?? {})].map((k) => [
        k,
        `touch ${join(pwned, 'fork-code-ran')}`,
      ]),
    )
    writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg, null, 2))
    writeFileSync(join(dir, 'Makefile'), `all:\n\ttouch ${join(pwned, 'fork-code-ran')}\n`)
  }
}

function forkPayload({ action, association, additions, deletions, title, pwned }) {
  return {
    action,
    number: PR,
    pull_request: {
      number: PR,
      title,
      body: `Fixes the docs.\n\n$(touch ${pwned}/body) \`touch ${pwned}/body2\``,
      state: 'open',
      user: { login: 'new-contributor' },
      author_association: association,
      additions,
      deletions,
      changed_files: 3,
      merge_commit_sha: 'c'.repeat(40),
      html_url: `https://github.com/${REPOSITORY}/pull/${PR}`,
      head: {
        ref: `docs";touch\${IFS}${pwned}/branch;#`,
        sha: 'f'.repeat(40),
        label: `new-contributor:docs";touch\${IFS}${pwned}/label;#`,
        repo: { full_name: 'new-contributor/tidepool', fork: true, clone_url: 'https://github.com/new-contributor/tidepool.git' },
      },
      base: { ref: 'main', sha: 'b'.repeat(40), repo: { full_name: REPOSITORY, fork: false } },
    },
    repository: { full_name: REPOSITORY, name: 'tidepool', owner: { login: 'tidepool-dev' }, default_branch: 'main' },
    sender: { login: 'new-contributor' },
  }
}

async function runFor(scenario) {
  const pwned = freshDir('pwn-pr-')
  const sim = await simulate(root, {
    eventName: 'pull_request_target',
    payload: forkPayload({ ...scenario, pwned }),
    repository: REPOSITORY,
    forkFiles: forkFiles(pwned),
    versionOf,
  })
  return { sim, pwned }
}

const TITLE = (p) => `Fix "typo" in README $(touch ${p}/t1) \`touch ${p}/t2\` "; touch ${p}/t3; echo "`

function check(sim, pwned) {
  assert.deepEqual(pwnedFiles(pwned), [], `code from the fork or its text ran with the write token:\n${describeRun(sim)}`)
  const ran = sim.runs.filter((r) => !r.skipped)
  assert.ok(ran.length > 0, 'no pull_request_target workflow handled the fork PR (fork PRs get a read-only token on pull_request)')
  const failed = sim.runs.filter((r) => r.failed)
  assert.equal(failed.length, 0, `PR triage failed for a fork PR:\n${describeRun(sim)}`)
}

const labels = (sim) => [...new Set(sim.effects.labels.filter((l) => l.number === PR).map((l) => l.label))]
const comments = (sim) => sim.effects.comments.filter((c) => c.number === PR)

test('every workflow file is valid YAML', () => {
  for (const w of loadWorkflows(root)) assert.equal(w.error, undefined, `${w.file}: ${w.error}`)
})

test('triage still runs on opened, synchronized and reopened pull requests', () => {
  const wfs = privileged().filter((w) => 'pull_request_target' in triggers(w.doc))
  assert.ok(wfs.length > 0, 'no workflow runs on pull_request_target any more, so fork PRs cannot be labelled')
  const types = new Set(
    wfs.flatMap((w) => [].concat(triggers(w.doc).pull_request_target?.types ?? ['opened', 'synchronize', 'reopened'])),
  )
  for (const t of ['opened', 'synchronize', 'reopened']) assert.ok(types.has(t), `pull_request_target no longer runs on ${t}`)
})

test('privileged workflows never fetch pull request code', () => {
  const found = privileged().flatMap((w) => untrustedCheckouts(w.doc).map((f) => `${w.file}: ${f}`))
  assert.deepEqual(found, [])
})

test('pull request text is never expanded into scripts', () => {
  const found = privileged().flatMap((w) => injectionSinks(w.doc).map((f) => `${w.file}: ${f}`))
  assert.deepEqual(found, [])
})

test('the write token is limited to labelling and commenting', () => {
  for (const w of privileged()) {
    for (const [jobId, job] of jobsOf(w.doc)) {
      const perms = effectivePermissions(w.doc, job)
      assert.ok(perms.declared, `${w.file}#${jobId} inherits the repository's default token permissions`)
      const extra = writeScopes(perms).filter((s) => s !== 'pull-requests' && s !== 'issues')
      assert.deepEqual(extra, [], `${w.file}#${jobId} grants write access it does not need: ${extra.join(', ')}`)
    }
  }
})

test('a first-time contributor opening a fork PR gets a size label and one welcome comment', async () => {
  const { sim, pwned } = await runFor({ action: 'opened', association: 'FIRST_TIME_CONTRIBUTOR', additions: 120, deletions: 30, title: 'Fix typo in README' })
  check(sim, pwned)
  assert.ok(labels(sim).includes('size/M'), `expected size/M on #${PR}, got ${JSON.stringify(labels(sim))}\n${describeRun(sim)}`)
  assert.equal(comments(sim).length, 1, `expected one welcome comment, got ${JSON.stringify(comments(sim))}`)
  assert.match(comments(sim)[0].body, /@new-contributor\b/, 'the welcome comment should greet the author')
})

test('a hostile title, body or branch name cannot run commands', async () => {
  const pwnedTitle = freshDir('pwn-title-')
  const { sim, pwned } = await runFor({
    action: 'opened',
    association: 'FIRST_TIME_CONTRIBUTOR',
    additions: 4,
    deletions: 1,
    title: TITLE(pwnedTitle),
  })
  assert.deepEqual(pwnedFiles(pwnedTitle), [], 'the PR title executed as shell code')
  check(sim, pwned)
  assert.ok(labels(sim).includes('size/XS'), `expected size/XS, got ${JSON.stringify(labels(sim))}\n${describeRun(sim)}`)
  assert.equal(comments(sim).length, 1, 'expected one welcome comment')
})

test('new commits relabel without commenting again', async () => {
  const { sim, pwned } = await runFor({ action: 'synchronize', association: 'FIRST_TIME_CONTRIBUTOR', additions: 600, deletions: 500, title: 'Rewrite parser' })
  check(sim, pwned)
  assert.ok(labels(sim).includes('size/XL'), `expected size/XL, got ${JSON.stringify(labels(sim))}\n${describeRun(sim)}`)
  assert.equal(comments(sim).length, 0, 'a welcome comment was posted on synchronize')
})

test('returning contributors are labelled but not welcomed', async () => {
  const { sim, pwned } = await runFor({ action: 'reopened', association: 'CONTRIBUTOR', additions: 300, deletions: 450, title: 'Support TOML front matter' })
  check(sim, pwned)
  assert.ok(labels(sim).includes('size/L'), `expected size/L, got ${JSON.stringify(labels(sim))}\n${describeRun(sim)}`)
  assert.equal(comments(sim).length, 0, 'returning contributors should not get the welcome comment')
})

test('pinned actions still resolve to real releases', () => {
  for (const w of privileged()) {
    for (const [, job] of jobsOf(w.doc)) {
      for (const step of job.steps ?? []) {
        const ref = actionRef(step.uses)
        const action = step.uses?.split('@')[0]
        if (/^[0-9a-f]{40}$/.test(ref ?? '') && SHAS[action])
          assert.ok(versionOf(action, ref), `${step.uses} is not a commit of any ${action} release tag`)
      }
    }
  }
})
