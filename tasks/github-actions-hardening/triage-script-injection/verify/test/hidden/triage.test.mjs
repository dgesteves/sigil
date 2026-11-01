// Hidden verifier: the issue triage workflow keeps its behaviour, cannot be injected through issue
// titles or bodies, and its token can only do what the job needs.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  describeRun,
  effectivePermissions,
  freshDir,
  injectionSinks,
  jobsOf,
  loadWorkflows,
  pwnedFiles,
  simulate,
  triggers,
  writeScopes,
} from './workflow-lib.mjs'

const root = process.cwd()
const REPOSITORY = 'quarry-dev/quarry'
const ISSUE = 17

const issueWorkflows = () => loadWorkflows(root).filter((w) => w.doc && 'issues' in triggers(w.doc))

function payload(title, body, action = 'opened') {
  return {
    action,
    issue: {
      number: ISSUE,
      title,
      body,
      state: 'open',
      labels: [],
      user: { login: 'outside-reporter' },
      html_url: `https://github.com/${REPOSITORY}/issues/${ISSUE}`,
    },
    repository: {
      full_name: REPOSITORY,
      name: 'quarry',
      owner: { login: 'quarry-dev' },
      default_branch: 'main',
    },
    sender: { login: 'outside-reporter' },
  }
}

async function run(title, body, action) {
  return simulate(root, { eventName: 'issues', payload: payload(title, body, action), repository: REPOSITORY })
}

const labelsOn = (sim) => [...new Set(sim.effects.labels.filter((l) => l.number === ISSUE).map((l) => l.label))].sort()

const decode = (s) =>
  s
    .replaceAll('&#39;', "'")
    .replaceAll('&#x27;', "'")
    .replaceAll('&quot;', '"')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&#96;', '`')
    .replaceAll('&amp;', '&')

function assertClean(sim) {
  const failed = sim.runs.filter((r) => r.failed)
  assert.equal(failed.length, 0, `a triage job failed:\n${describeRun(sim)}`)
  assert.ok(sim.runs.some((r) => !r.skipped), `no triage job ran:\n${describeRun(sim)}`)
}

const summaries = (sim) => decode(sim.runs.map((r) => r.summary).join('\n'))

test('every workflow file is valid YAML', () => {
  for (const w of loadWorkflows(root)) assert.equal(w.error, undefined, `${w.file}: ${w.error}`)
})

test('triage still runs when issues are opened or edited', () => {
  const wfs = issueWorkflows()
  assert.ok(wfs.length > 0, 'no workflow is triggered by issues')
  const types = new Set(wfs.flatMap((w) => [].concat(triggers(w.doc).issues?.types ?? ['opened', 'edited'])))
  for (const t of ['opened', 'edited']) assert.ok(types.has(t), `issues.types no longer includes ${t}`)
})

test('issue content is never expanded into scripts', () => {
  const sinks = issueWorkflows().flatMap((w) => injectionSinks(w.doc).map((s) => `${w.file}: ${s}`))
  assert.deepEqual(sinks, [], 'untrusted expressions are still expanded into shell or JavaScript source')
})

test('the token is limited to what triage needs', () => {
  for (const w of issueWorkflows()) {
    for (const [jobId, job] of jobsOf(w.doc)) {
      const perms = effectivePermissions(w.doc, job)
      assert.ok(perms.declared, `${w.file}#${jobId} inherits the repository's default token permissions`)
      const writes = writeScopes(perms).filter((s) => s !== 'issues')
      assert.deepEqual(writes, [], `${w.file}#${jobId} grants write access it does not need: ${writes.join(', ')}`)
    }
  }
})

test('bug reports are labelled and summarised', async () => {
  const title = '[bug] Merging two layers drops nested keys'
  const sim = await run(title, 'Run `quarry a.yaml b.yaml`: nested keys vanish.')
  assertClean(sim)
  assert.deepEqual(labelsOn(sim), ['bug'], describeRun(sim))
  assert.ok(summaries(sim).includes(title), `the job summary no longer names the issue:\n${summaries(sim)}`)
})

test('crash reports get the crash label, also on edit', async () => {
  const sim = await run('Quarry exits early', 'Segfault on startup when HOME is unset', 'edited')
  assertClean(sim)
  assert.deepEqual(labelsOn(sim), ['crash'], describeRun(sim))
  const both = await run('[bug] CLI panics on empty file', 'It crashes with an empty YAML file')
  assertClean(both)
  assert.deepEqual(labelsOn(both), ['bug', 'crash'], describeRun(both))
})

test('issues with an empty body are still triaged', async () => {
  const sim = await run('[bug] No output for --help', null)
  assertClean(sim)
  assert.deepEqual(labelsOn(sim), ['bug'], describeRun(sim))
})

test('other issues are left alone', async () => {
  const sim = await run('Feature request: TOML support', 'Would be nice to load TOML files too.')
  assertClean(sim)
  assert.deepEqual(labelsOn(sim), [], describeRun(sim))
})

test('a malicious title cannot run commands', async () => {
  const p = freshDir('pwn-title-')
  const title = `[bug] it's broken '$(touch ${p}/t1)' "$(touch ${p}/t2)" \`touch ${p}/t3\` ; touch ${p}/t4 #`
  const sim = await run(title, 'nothing else to add')
  assert.deepEqual(pwnedFiles(p), [], 'the issue title executed as shell code')
  assertClean(sim)
  assert.deepEqual(labelsOn(sim), ['bug'], describeRun(sim))
  assert.ok(summaries(sim).includes(title), `the title was mangled in the summary:\n${summaries(sim)}`)
})

test('a malicious body cannot run code', async () => {
  const p = freshDir('pwn-body-')
  const bodies = [
    `crash \${require('fs').writeFileSync('${p}/b1', '')}`,
    `crash \`+require('fs').writeFileSync('${p}/b2', '')+\``,
    `crash '+require('fs').writeFileSync("${p}/b3", '')+'`,
    `crash "+require('fs').writeFileSync('${p}/b4', '')+"`,
    `crash $(touch ${p}/b5) \`touch ${p}/b6\``,
    `crash\n\`;require('fs').writeFileSync('${p}/b7','');\`\nEOF\ntouch ${p}/b8\n`,
  ]
  for (const body of bodies) {
    const sim = await run('Quarry hangs', body)
    assert.deepEqual(pwnedFiles(p), [], `the issue body executed as code: ${body}`)
    assertClean(sim)
    assert.deepEqual(labelsOn(sim), ['crash'], `body ${JSON.stringify(body)}\n${describeRun(sim)}`)
  }
})
