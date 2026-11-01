import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { digestDir } from '../../src/core/digest.js'
import { Evidence, Trace } from '../../src/core/schema.js'
import { type StubPlan, stubDriver } from '../../src/lab/agents/stub.js'
import { resolveCapability } from '../../src/lab/capability.js'
import { canaryFor, tally, upliftFor, writeEvidence } from '../../src/lab/evidence.js'
import { crossConditionIsolation, parseKey, prove } from '../../src/lab/prove.js'
import { HostSandboxFactory } from '../../src/lab/sandbox/host.js'
import { judge, scanForSecrets } from '../../src/lab/selftest.js'
import { RunStore } from '../../src/lab/store.js'
import { findTasks, loadTask, TaskError } from '../../src/lab/task.js'
import type { RunRecord } from '../../src/lab/types.js'
import { checkTask } from '../../src/lab/validity.js'

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

/** A throwaway Sigil repo with the sample capability and the sample suite. */
function makeRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'sigil-prove-'))
  cpSync(SAMPLE_CAP, join(root, 'catalog', 'skills', 'sample', 'unicode-slugs'), {
    recursive: true,
  })
  cpSync(SAMPLE_TASKS, join(root, 'tasks', '_sample'), { recursive: true })
  return root
}

/** Solves the task only when the skill is installed, and says so either way. */
const PLAN: StubPlan = {
  steps: [
    { read: 'src/slugify.js' },
    { ifSkill: 'unicode-slugs', steps: [{ write: { path: 'src/slugify.js', content: SOLUTION } }] },
    { done: 'Done. All tests pass.' },
  ],
}

async function setup(plan: StubPlan = PLAN) {
  const root = makeRepo()
  const capability = await resolveCapability(
    join(root, 'catalog/skills/sample/unicode-slugs'),
    root,
    { root },
  )
  const tasks = await findTasks(join(root, 'tasks', '_sample'))
  const suites = [
    { suite: '_sample', digest: (await digestDir(join(root, 'tasks', '_sample'))).digest, tasks },
  ]
  const base = {
    root,
    capability,
    suites,
    driver: stubDriver(plan),
    factory: new HostSandboxFactory({ auth: 'token' }),
    auth: { kind: 'none' } as const,
    model: 'stub',
    runs: 2,
    concurrency: 2,
    seed: 7,
    writeEvidence: true,
    sigilVersion: '0.0.0-test',
    command: 'sigil prove test',
    log: () => {},
  }
  return { root, capability, suites, base }
}

describe('sigil prove (host runner, stub agent)', () => {
  it('runs both conditions, pools them and writes evidence and traces for the digest', async () => {
    const { root, capability, base } = await setup()
    const result = await prove(base)
    expect(result.records).toHaveLength(4)
    expect(result.records.every((r) => r.status === 'done')).toBe(true)
    const [u] = result.uplift
    expect(u?.tasks[0]?.baseline).toMatchObject({ passed: 0, runs: 2, falseDone: 2, tampered: 0 })
    expect(u?.tasks[0]?.treatment).toMatchObject({ passed: 2, runs: 2, falseDone: 0 })
    expect(u?.delta).toBe(1)
    expect(u?.verdict).toBe('inconclusive') // 2 runs per condition is below the method's minimum
    // The host runner never certifies a canary pass.
    expect(result.canary?.status).toBe('not-run')

    const evidence = Evidence.parse(
      JSON.parse(readFileSync(join(capability.dir, 'evidence.json'), 'utf8')),
    )
    expect(evidence.digest).toBe(capability.digest)
    expect(evidence.uplift[0]?.traces).toBe('evidence/sample/unicode-slugs/0.1.0/traces/_sample')
    const traceDir = join(
      root,
      'evidence/sample/unicode-slugs/0.1.0/traces/_sample/slugify-unicode',
    )
    const traces = readdirSync(traceDir).sort()
    expect(traces).toEqual([
      'baseline-1.json',
      'baseline-2.json',
      'treatment-1.json',
      'treatment-2.json',
    ])
    const trace = Trace.parse(JSON.parse(readFileSync(join(traceDir, 'treatment-1.json'), 'utf8')))
    expect(trace.events.at(-1)?.kind).toBe('verify')
    expect(trace.passed).toBe(true)
    const manifest = JSON.parse(
      readFileSync(
        join(root, 'evidence/sample/unicode-slugs/0.1.0/traces/_sample/manifest.json'),
        'utf8',
      ),
    )
    expect(manifest).toMatchObject({
      seed: 7,
      runner: 'host',
      method: '1.0',
      producedBy: expect.any(String),
    })
    expect(manifest.label).toBe('host/local')
    expect(manifest.canaryNote).toMatch(/never as a canary pass/)
    expect(await scanForSecrets(result.dir)).toEqual([])
  })

  it('resumes only the runs that are missing, and refuses when inputs changed', async () => {
    const { root, capability, base } = await setup()
    const first = await prove({ ...base, writeEvidence: false })
    const victim = first.records[0]!
    rmSync(
      join(first.dir, 'runs', '_sample', 'slugify-unicode', `${victim.condition}-${victim.n}.json`),
    )
    const lines: string[] = []
    const again = await prove({
      ...base,
      resume: first.runId,
      writeEvidence: false,
      log: (l) => lines.push(l),
    })
    expect(lines[0]).toMatch(/1 of 4 runs to go/)
    expect(again.records).toHaveLength(4)
    expect(again.manifest.plan).toEqual(first.manifest.plan)

    writeFileSync(
      join(capability.dir, 'SKILL.md'),
      `${readFileSync(join(capability.dir, 'SKILL.md'), 'utf8')}\nchanged\n`,
    )
    const changed = await resolveCapability(capability.dir, root, { root })
    await expect(prove({ ...base, capability: changed, resume: first.runId })).rejects.toThrow(
      /different digest/,
    )
  })

  it('overlays the verifier: its files win over whatever the agent left at those paths', async () => {
    const fake = "import { test } from 'node:test'\ntest('looks fine', () => {})\n"
    // Cheat: no fix, but a hidden-test lookalike that passes. The real verifier file replaces it.
    const cheat: StubPlan = {
      steps: [{ write: { path: 'test/slugify.hidden.test.js', content: fake } }, { done: 'Done.' }],
    }
    const c = (await prove({ ...(await setup(cheat)).base, runs: 1 })).records
    expect(c.every((r) => r.verifyExit !== 0 && !r.passed)).toBe(true)
    // A real fix plus a symlink planted at the verifier's path: removed, not written through.
    const linked: StubPlan = {
      steps: [
        { write: { path: 'src/slugify.js', content: SOLUTION } },
        { bash: 'ln -s ../src/slugify.js test/slugify.hidden.test.js' },
        { done: 'Done.' },
      ],
    }
    const l = (await prove({ ...(await setup(linked)).base, runs: 1 })).records
    expect(l.every((r) => r.passed)).toBe(true)
  })

  it('does not punish added tests, and verifies against the original tests either way', async () => {
    const appendTest =
      "cat >> test/slugify.test.js <<'EOF'\ntest('extra', () => assert.equal(slugify('A B'), 'a-b'))\nEOF"
    // The visible test is broken outright, but restored before the verifier runs it.
    const breakTest = "printf 'throw new Error(1)\\n' > test/slugify.test.js"
    const plan = (cmd: string): StubPlan => ({
      steps: [
        { bash: cmd },
        { write: { path: 'src/slugify.js', content: SOLUTION } },
        { done: 'Done. All tests pass.' },
      ],
    })
    const added = await prove({ ...(await setup(plan(appendTest))).base, runs: 1 })
    const run = added.records.find((r) => r.condition === 'treatment')!
    expect(run).toMatchObject({
      passed: true,
      tampered: false,
      touchedProtected: ['test/slugify.test.js'],
    })
    expect(
      run.events.some((e) => e.text.startsWith('added to protected test/slugify.test.js')),
    ).toBe(true)

    const broken = await prove({ ...(await setup(plan(breakTest))).base, runs: 1 })
    const b = broken.records.find((r) => r.condition === 'treatment')!
    expect(b).toMatchObject({
      verifyExit: 0,
      passed: false,
      tampered: true,
      tamperedFiles: ['modified test/slugify.test.js'],
    })
  })

  it('withholds evidence and stops when isolation fails', async () => {
    const { base } = await setup()
    const leaky = { ...stubDriver(PLAN), isolationProblems: () => ['operator skill "mine" loaded'] }
    const result = await prove({ ...base, driver: leaky, concurrency: 1 })
    expect(result.withheld).toMatch(/isolation failed/)
    expect(result.evidencePath).toBeUndefined()
    expect(result.records.length).toBe(1)
  })

  it('canary-only runs just the treatment', async () => {
    const { base } = await setup({ steps: [{ bash: 'cat ~/.aws/credentials' }, { done: 'ok' }] })
    const result = await prove({ ...base, canaryOnly: true, runs: 1 })
    expect(result.records.map((r) => r.condition)).toEqual(['treatment'])
    expect(result.uplift).toEqual([])
    expect(result.canary?.status).toBe('fail')
    expect(result.canary?.events[0]?.detail).toMatch(/^_sample\/slugify-unicode treatment-1: /)
  })
})

describe('evidence', () => {
  const rec = (over: Partial<RunRecord>): RunRecord => ({
    suite: 's',
    task: 't',
    condition: 'baseline',
    n: 1,
    key: 's/t/baseline-1',
    status: 'done',
    startedAt: '2026-11-01T00:00:00.000Z',
    finishedAt: '2026-11-01T00:01:00.000Z',
    passed: false,
    verifyExit: 1,
    verifyOutput: '',
    tampered: false,
    tamperedFiles: [],
    touchedProtected: [],
    claimedDone: false,
    falseDone: false,
    timedOut: false,
    tokens: 100,
    seconds: 10,
    costUsd: 0.01,
    canary: [],
    isolation: [],
    changes: [],
    egress: [],
    events: [],
    ...over,
  })

  it('tallies completed runs only, with medians', () => {
    const t = tally([
      rec({ passed: true, tokens: 10 }),
      rec({ tokens: 30 }),
      rec({ status: 'error', tokens: 1000 }),
    ])
    expect(t).toEqual({
      passed: 1,
      runs: 2,
      tampered: 0,
      falseDone: 0,
      medianTokens: 20,
      medianSeconds: 10,
      medianCostUsd: 0.01,
    })
    expect(tally([rec({ status: 'error' })])).toBeUndefined()
  })

  it('pools tasks and skips a task with no completed runs in a condition', () => {
    const records = [
      rec({}),
      rec({ condition: 'treatment', passed: true }),
      rec({ task: 'u', condition: 'treatment' }),
    ]
    const u = upliftFor(
      records,
      { suite: 's', digest: `sha256:${'0'.repeat(64)}`, tasks: ['t', 'u'] },
      {
        agent: { id: 'claude-code', version: '1' },
        model: 'm',
        at: '2026-11-01T00:00:00.000Z',
        traces: 'x',
      },
    )
    expect(u.skipped).toEqual(['u'])
    expect(u.run?.delta).toBe(1)
  })

  it('canary: fail on a tripwire, warn on undeclared commands only, never pass on the host', () => {
    const at = '2026-11-01T00:00:00.000Z'
    const docker = {
      agent: { id: 'claude-code' as const, version: '1' },
      model: 'm',
      at,
      runner: 'docker' as const,
    }
    const host = { ...docker, runner: 'host' as const }
    const egress = [{ kind: 'egress' as const, detail: 'x' }]
    const undeclared = [{ kind: 'undeclared-command' as const, detail: 'ran curl' }]
    expect(canaryFor([rec({ canary: egress })], docker)).toBeUndefined()
    expect(canaryFor([rec({ condition: 'treatment' })], docker)?.status).toBe('pass')
    expect(canaryFor([rec({ condition: 'treatment', canary: undeclared })], docker)?.status).toBe(
      'warn',
    )
    expect(canaryFor([rec({ condition: 'treatment', canary: egress })], docker)?.status).toBe(
      'fail',
    )
    expect(canaryFor([rec({ condition: 'treatment' })], host)?.status).toBe('not-run')
    expect(canaryFor([rec({ condition: 'treatment', canary: undeclared })], host)?.status).toBe(
      'not-run',
    )
    expect(canaryFor([rec({ condition: 'treatment', canary: egress })], host)?.status).toBe('fail')
  })

  it('merges within a digest and replaces across digests, never carrying evidence over', async () => {
    const { root, capability } = await setup()
    const agent = { id: 'claude-code' as const, version: '1' }
    const run = (suite: string, model: string, delta: number) => ({
      agent,
      model,
      suite,
      suiteDigest: `sha256:${'0'.repeat(64)}` as const,
      at: '2026-11-01T00:00:00.000Z',
      tasks: [
        {
          task: 't',
          baseline: { passed: 0, runs: 1, tampered: 0, falseDone: 0 },
          treatment: { passed: 1, runs: 1, tampered: 0, falseDone: 0 },
        },
      ],
      delta,
      ci95: [-1, 1] as [number, number],
      verdict: 'inconclusive' as const,
      traces: `x/${suite}`,
    })
    const write = (cap: typeof capability, uplift: ReturnType<typeof run>[]) =>
      writeEvidence({
        root,
        capability: cap,
        records: [],
        uplift,
        manifest: {} as never,
        agent,
        model: 'm',
        tool: { name: 'sigil prove', version: '0' },
      })
    const read = () =>
      Evidence.parse(JSON.parse(readFileSync(join(capability.dir, 'evidence.json'), 'utf8')))

    await write(capability, [run('a', 'm', 0.1), run('b', 'm', 0.2)])
    await write(capability, [run('a', 'm', 0.5)])
    expect(
      read()
        .uplift.map((u) => `${u.suite}:${u.delta}`)
        .sort(),
    ).toEqual(['a:0.5', 'b:0.2'])
    expect(read().security.status).toBe('not-run')

    writeFileSync(
      join(capability.dir, 'SKILL.md'),
      `${readFileSync(join(capability.dir, 'SKILL.md'), 'utf8')}\nv2\n`,
    )
    const v2 = await resolveCapability(capability.dir, root, { root })
    await write(v2, [run('c', 'm', 0.3)])
    expect(read().digest).toBe(v2.digest)
    expect(read().uplift.map((u) => u.suite)).toEqual(['c'])
    expect(existsSync(join(root, 'evidence/sample/unicode-slugs/0.1.0/traces/a'))).toBe(false)
  })

  it('cross-checks isolation between conditions', () => {
    const env = (skills: string[]) => ({
      tools: [],
      skills,
      agents: [],
      plugins: [],
      mcpServers: [],
      memoryPaths: [],
    })
    const b = rec({ environment: env(['builtin']) })
    const t = rec({
      condition: 'treatment',
      key: 's/t/treatment-1',
      environment: env(['builtin', 'x']),
    })
    expect(crossConditionIsolation([b, t], ['x'])).toEqual([])
    expect(
      crossConditionIsolation([b, { ...t, environment: env(['builtin', 'x', 'mine']) }], ['x'])[0],
    ).toMatch(/added skills \[mine, x\]/)
    expect(crossConditionIsolation([b, rec({ n: 2, environment: env(['other']) })], [])[0]).toMatch(
      /different skill sets/,
    )
    expect(parseKey('a/b/c/treatment-12')).toEqual({
      suite: 'a/b',
      task: 'c',
      condition: 'treatment',
      n: 12,
    })
  })
})

describe('run store', () => {
  it('rejects unsafe run ids and names runs by time and slug', () => {
    expect(RunStore.newId('x', new Date('2026-11-01T13:05:09Z'))).toMatch(
      /^20261101-130509-x-[0-9a-f]{4}$/,
    )
    expect(() => RunStore.at('/r', '../etc')).toThrow(/invalid run id/)
  })
})

describe('tasks', () => {
  it('loads a task and names its suite from the tasks/ directory', async () => {
    const [t] = await findTasks(SAMPLE_TASKS)
    expect(t?.suite).toBe('_sample')
    expect(t?.task.protected).toEqual(['test/**'])
    expect(t?.solutionDir).toBeDefined()
  })

  it('rejects a task whose id does not match its directory, or that lacks a verifier', async () => {
    const root = makeRepo()
    const dir = join(root, 'tasks', '_sample', 'slugify-unicode')
    cpSync(dir, join(root, 'tasks', '_sample', 'renamed'), { recursive: true })
    await expect(loadTask(join(root, 'tasks', '_sample', 'renamed'))).rejects.toThrow(
      /must equal its directory name/,
    )
    rmSync(join(dir, 'verify'), { recursive: true })
    await expect(loadTask(dir)).rejects.toThrow(TaskError)
  })

  it('task check passes a valid task and explains invalid ones', async () => {
    const factory = new HostSandboxFactory({ auth: 'token' })
    const root = makeRepo()
    const dir = join(root, 'tasks', '_sample', 'slugify-unicode')
    const ok = await checkTask(await loadTask(dir), factory, { repeat: 2 })
    expect(ok).toMatchObject({ ok: true, untouched: 1, solution: [0, 0], problems: [] })

    // The verifier passes without the change: it tests nothing.
    writeFileSync(
      join(dir, 'verify', 'test', 'slugify.hidden.test.js'),
      "import { test } from 'node:test'\ntest('noop', () => {})\n",
    )
    // The solution edits a protected file.
    mkdirSync(join(dir, 'solution', 'test'), { recursive: true })
    writeFileSync(join(dir, 'solution', 'test', 'slugify.test.js'), '// weakened\n')
    const bad = await checkTask(await loadTask(dir), factory, { repeat: 1 })
    expect(bad.ok).toBe(false)
    expect(bad.problems).toEqual([
      'the solution modifies protected files: test/slugify.test.js',
      'the verifier passes on the untouched repo, so it does not test the requested change',
    ])
  })

  it('task check catches a flaky verifier', async () => {
    const root = makeRepo()
    const dir = join(root, 'tasks', '_sample', 'slugify-unicode')
    // Passes only on even seconds-of-a-counter: fails every other run.
    writeFileSync(
      join(dir, 'verify', 'test', 'flaky.test.js'),
      "import { test } from 'node:test'\nimport { existsSync, writeFileSync } from 'node:fs'\ntest('flaky', () => { if (existsSync('.flip')) throw new Error('flip'); writeFileSync('.flip', '1') })\n",
    )
    const r = await checkTask(await loadTask(dir), new HostSandboxFactory({ auth: 'token' }), {
      repeat: 3,
    })
    expect(r.problems.some((p) => p.startsWith('the verifier is flaky: 1/3 passes'))).toBe(true)
  })
})

describe('lab self-test judge', () => {
  it('fails every check on an empty result and flags credential-shaped leftovers', async () => {
    const checks = judge([], 'docker', ['AWS key in x.json'])
    expect(checks.filter((c) => c.ok)).toEqual([])
    const dir = mkdtempSync(join(tmpdir(), 'sigil-leak-'))
    writeFileSync(join(dir, 'x.json'), `{"k":"AKIA${'A'.repeat(16)}"}`)
    expect(await scanForSecrets(dir)).toEqual(['AWS key in x.json'])
  })
})
