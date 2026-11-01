import { createHash } from 'node:crypto'
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { describe, expect, it } from 'vitest'
import { main } from '../../src/cli/main.js'
import { digestDir } from '../../src/core/digest.js'
import { Evidence, Trace } from '../../src/core/schema.js'
import { claudeCode } from '../../src/lab/agents/claude-code.js'
import { type StubPlan, stubDriver } from '../../src/lab/agents/stub.js'
import { resolveCapability } from '../../src/lab/capability.js'
import { prove, rescore } from '../../src/lab/prove.js'
import { HostSandboxFactory } from '../../src/lab/sandbox/host.js'
import { findTasks } from '../../src/lab/task.js'
import type { RunRecord } from '../../src/lab/types.js'

const here = import.meta.dirname
const SAMPLE_TASKS = join(here, '..', '..', '..', '..', 'tasks', '_sample')
const SAMPLE_CAP = join(
  here,
  '..',
  'fixtures',
  'lab',
  'catalog',
  'skills',
  'sample',
  'unicode-slugs',
)
const SOLUTION = readFileSync(
  join(SAMPLE_TASKS, 'slugify-unicode', 'solution', 'src', 'slugify.js'),
  'utf8',
)

/** Fixes the code and rewrites the protected test wholesale, like the zod runs did. */
const PLAN: StubPlan = {
  steps: [
    { write: { path: 'src/slugify.js', content: SOLUTION } },
    { bash: "printf 'rewritten\\n' > test/slugify.test.js" },
    { done: 'Done. All tests pass.' },
  ],
}

/** A Sigil repo with one stored session: the fixture run dir rescore works on. */
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'sigil-rescore-'))
  cpSync(SAMPLE_CAP, join(root, 'catalog', 'skills', 'sample', 'unicode-slugs'), {
    recursive: true,
  })
  cpSync(SAMPLE_TASKS, join(root, 'tasks', '_sample'), { recursive: true })
  const load = async () => {
    const capability = await resolveCapability(
      join(root, 'catalog/skills/sample/unicode-slugs'),
      root,
      { root },
    )
    const tasks = await findTasks(join(root, 'tasks', '_sample'))
    const suites = [
      { suite: '_sample', digest: (await digestDir(join(root, 'tasks', '_sample'))).digest, tasks },
    ]
    return { capability, suites }
  }
  const { capability, suites } = await load()
  const run = await prove({
    root,
    capability,
    suites,
    driver: stubDriver(PLAN),
    factory: new HostSandboxFactory({ auth: 'token' }),
    auth: { kind: 'none' },
    model: 'stub',
    runs: 1,
    concurrency: 2,
    seed: 3,
    writeEvidence: false,
    sigilVersion: '0.0.0-test',
    command: 'sigil prove test',
    log: () => {},
  })
  // Rewrite the stored treatment as the pre-1.1 scoring stored it: tampered, so "failed" and "false done".
  const file = join(run.dir, 'runs', '_sample', 'slugify-unicode', 'treatment-1.json')
  const stored = JSON.parse(readFileSync(file, 'utf8')) as RunRecord
  writeFileSync(file, JSON.stringify({ ...stored, passed: false, falseDone: true }))
  return { root, run, load }
}

/** Content hash of a directory tree, to prove rescore never writes into lab-runs/. */
function treeHash(dir: string): string {
  const h = createHash('sha256')
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name)
      if (statSync(p).isDirectory()) walk(p)
      else h.update(`${p}\0${readFileSync(p).toString('base64')}\0${statSync(p).mtimeMs}\0`)
    }
  }
  walk(dir)
  return h.digest('hex')
}

const opts = (
  root: string,
  runId: string,
  loaded: Awaited<ReturnType<Awaited<ReturnType<typeof fixture>>['load']>>,
) => ({
  root,
  runId,
  ...loaded,
  driver: { ...claudeCode, id: 'generic' as const },
  writeEvidence: true,
  sigilVersion: '0.0.0-rescore',
  log: () => {},
})

describe('sigil prove --rescore', () => {
  it('re-publishes stored runs with the current scoring, without touching them', async () => {
    const { root, run, load } = await fixture()
    const before = treeHash(run.dir)
    const result = await rescore(opts(root, run.runId, await load()))
    expect(treeHash(run.dir)).toBe(before)

    const t = result.records.find((r) => r.condition === 'treatment')!
    expect(t).toMatchObject({ passed: true, falseDone: false, tampered: true })
    expect(result.uplift[0]?.tasks[0]?.treatment).toMatchObject({
      passed: 1,
      runs: 1,
      tampered: 1,
      falseDone: 0,
    })
    expect(result.uplift[0]?.at).toBe(run.manifest.finishedAt)

    const cap = join(root, 'catalog/skills/sample/unicode-slugs')
    expect(
      Evidence.parse(JSON.parse(readFileSync(join(cap, 'evidence.json'), 'utf8'))).uplift,
    ).toHaveLength(1)
    const traces = join(root, 'evidence/sample/unicode-slugs/0.1.0/traces/_sample')
    const trace = Trace.parse(
      JSON.parse(readFileSync(join(traces, 'slugify-unicode/treatment-1.json'), 'utf8')),
    )
    expect(trace).toMatchObject({ passed: true, tampered: true, falseDone: false })
    expect(trace.events.at(-1)).toMatchObject({ kind: 'verify', ok: true })
    const published = JSON.parse(readFileSync(join(traces, 'manifest.json'), 'utf8'))
    expect(published.rescored).toMatchObject({ sigilVersion: '0.0.0-rescore', method: '1.0' })
    expect(published.runId).toBe(run.runId)
  })

  it('refuses when the capability or a suite changed since the runs', async () => {
    const { root, run, load } = await fixture()
    const skill = join(root, 'catalog/skills/sample/unicode-slugs/SKILL.md')
    const original = readFileSync(skill, 'utf8')
    writeFileSync(skill, `${original}\nchanged\n`)
    await expect(rescore(opts(root, run.runId, await load()))).rejects.toThrow(
      /capability changed since the runs/,
    )
    writeFileSync(skill, original)
    writeFileSync(join(root, 'tasks/_sample/slugify-unicode/repo/src/extra.js'), '// new\n')
    await expect(rescore(opts(root, run.runId, await load()))).rejects.toThrow(
      /suite _sample changed since the runs/,
    )
  })

  it('works from the CLI, and --no-evidence writes nothing', async () => {
    const { root, run } = await fixture()
    const lines: string[] = []
    const ctx = { cwd: root, out: (l = '') => lines.push(l), err: (l = '') => lines.push(l) }
    // The stub's runs are recorded as the generic agent, which has no lab driver.
    expect(await main(['prove', '--rescore', run.runId, '--no-evidence'], ctx)).toBe(2)
    expect(stripVTControlCharacters(lines.join('\n'))).toMatch(
      /ran generic, which has no lab driver/,
    )
    expect(await main(['prove', '--rescore', run.runId, '--resume', run.runId], ctx)).toBe(2)
    expect(existsSync(join(root, 'catalog/skills/sample/unicode-slugs/evidence.json'))).toBe(false)
    expect(await main(['prove', '--rescore', 'no-such-run'], ctx)).toBe(2)

    // Labelled as a Claude Code session, the same runs rescore end to end through the CLI.
    const manifestFile = join(run.dir, 'manifest.json')
    const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'))
    writeFileSync(
      manifestFile,
      JSON.stringify({ ...manifest, agent: { ...manifest.agent, id: 'claude-code' } }),
    )
    lines.length = 0
    expect(await main(['prove', '--rescore', run.runId, '--no-evidence'], ctx)).toBe(0)
    expect(stripVTControlCharacters(lines.join('\n'))).toMatch(
      /_sample\s+baseline 1\/1\s+treatment 1\/1/,
    )
    expect(existsSync(join(root, 'catalog/skills/sample/unicode-slugs/evidence.json'))).toBe(false)
    expect(
      await main(['prove', 'catalog/skills/sample/unicode-slugs', '--rescore', run.runId], ctx),
    ).toBe(0)
    expect(existsSync(join(root, 'catalog/skills/sample/unicode-slugs/evidence.json'))).toBe(true)
  })
})
