import { posix, relative, sep } from 'node:path'
import { SPEC_VERSION } from '../core/ids.js'
import type { UpliftRun } from '../core/schema.js'
import type { AgentDriver } from './agents/types.js'
import type { Auth } from './auth.js'
import type { LabCapability } from './capability.js'
import { attachUndeclared } from './commands.js'
import {
  type AgentStamp,
  canaryFor,
  HOST_CANARY_NOTE,
  reportedModel,
  tracesDir,
  upliftFor,
  writeEvidence,
} from './evidence.js'
import { buildPlan, parallel } from './plan.js'
import { newSeed } from './rng.js'
import { runOne, SETUP_EGRESS } from './run.js'
import type { PreparedImage, SandboxFactory } from './sandbox/types.js'
import { type ReproManifest, RunStore } from './store.js'
import type { LoadedTask } from './task.js'
import {
  type CanaryRun,
  CONDITIONS,
  type Condition,
  keyOf,
  type PlanItem,
  type RunRecord,
} from './types.js'

export interface SuiteInput {
  suite: string
  digest: string
  tasks: LoadedTask[]
}

export interface ProveOptions {
  /** Repo root: holds lab-runs/ and evidence/. */
  root: string
  capability: LabCapability
  suites: SuiteInput[]
  driver: AgentDriver
  factory: SandboxFactory
  auth: Auth
  model: string
  runs: number
  concurrency: number
  seed?: number
  canaryOnly?: boolean
  resume?: string
  /** Agent version to install in the sandbox image (Docker). */
  agentVersion?: string
  maxBudgetUsd?: number
  /** False for self-tests and dry runs: raw runs are kept, nothing is published. */
  writeEvidence: boolean
  sigilVersion: string
  command: string
  log: (line: string) => void
  now?: () => Date
}

export interface ProveResult {
  runId: string
  dir: string
  manifest: ReproManifest
  records: RunRecord[]
  uplift: UpliftRun[]
  canary?: CanaryRun
  evidencePath?: string
  traces: number
  /** Why evidence was not written, if it was not. */
  withheld?: string
}

export class ProveError extends Error {}

export async function prove(opts: ProveOptions): Promise<ProveResult> {
  const now = opts.now ?? (() => new Date())
  const conditions: Condition[] = opts.canaryOnly ? ['treatment'] : [...CONDITIONS]
  const tasks = new Map<string, LoadedTask>()
  for (const s of opts.suites) for (const t of s.tasks) tasks.set(`${s.suite}/${t.task.id}`, t)

  // Images: one per distinct task image, all with the same agent version.
  const images = new Map<string, PreparedImage>()
  for (const t of tasks.values()) {
    if (!images.has(t.task.image)) {
      images.set(
        t.task.image,
        await opts.factory.prepare(t.task.image, opts.driver, opts.agentVersion),
      )
    }
  }
  const first = images.values().next().value as PreparedImage
  const agentVersion = (await opts.factory.agentVersion(first, opts.driver)) ?? opts.agentVersion
  if (!agentVersion)
    throw new ProveError(`could not determine the ${opts.driver.label} version in the sandbox`)
  const agent: AgentStamp = { id: opts.driver.id, version: agentVersion }

  let store: RunStore
  let manifest: ReproManifest
  if (opts.resume) {
    store = RunStore.at(opts.root, opts.resume)
    manifest = await store.readManifest()
    const why = resumeConflict(manifest, opts, agentVersion, conditions)
    if (why) throw new ProveError(`cannot resume ${opts.resume}: ${why}`)
  } else {
    const runId = RunStore.newId(opts.capability.slug, now())
    const producedBy = process.env.GITHUB_ACTIONS === 'true' ? 'ci' : 'local'
    store = RunStore.at(opts.root, runId)
    const seed = opts.seed ?? newSeed()
    const plan = buildPlan(
      opts.suites.flatMap((s) => s.tasks.map((t) => ({ suite: s.suite, task: t.task.id }))),
      conditions,
      opts.runs,
      seed,
    )
    manifest = {
      sigil: 1,
      method: SPEC_VERSION,
      runId,
      producedBy,
      label: `${opts.factory.runner}/${producedBy}`,
      ...(opts.factory.runner === 'host' ? { canaryNote: HOST_CANARY_NOTE } : {}),
      sigilVersion: opts.sigilVersion,
      node: process.version,
      platform: `${process.platform}-${process.arch}`,
      command: opts.command,
      createdAt: now().toISOString(),
      capability: {
        id: opts.capability.manifest.id,
        version: opts.capability.manifest.version,
        digest: opts.capability.digest,
        path: relative(opts.root, opts.capability.dir).split(sep).join(posix.sep),
      },
      agent,
      model: { requested: opts.model, reported: [] },
      runner: opts.factory.runner,
      auth: opts.auth.kind,
      images: [...images.values()],
      suites: opts.suites.map((s) => ({
        suite: s.suite,
        digest: s.digest,
        tasks: s.tasks.map((t) => t.task.id),
      })),
      conditions,
      runs: opts.runs,
      concurrency: opts.concurrency,
      seed,
      ...(opts.maxBudgetUsd !== undefined ? { maxBudgetUsd: opts.maxBudgetUsd } : {}),
      egress: {
        setup: SETUP_EGRESS,
        agent: [...opts.driver.egress],
        harnessDenied: [...opts.driver.harnessDenied],
      },
      plan: plan.map(keyOf),
    }
    await store.writeManifest(manifest)
  }

  const done = new Set(
    (await store.readRecords()).filter((r) => r.status === 'done').map((r) => r.key),
  )
  const todo = manifest.plan.map(parseKey).filter((p) => !done.has(keyOf(p)))
  opts.log(
    `run ${manifest.runId}: ${todo.length} of ${manifest.plan.length} runs to go (seed ${manifest.seed})`,
  )

  let abort: string | undefined
  let finished = manifest.plan.length - todo.length
  await parallel(todo, opts.concurrency, async (item) => {
    if (abort) return
    const task = tasks.get(`${item.suite}/${item.task}`)
    if (!task)
      throw new ProveError(`plan names ${item.suite}/${item.task}, which is not in the suite`)
    const record = await runOne({
      item,
      task,
      capability: opts.capability,
      driver: opts.driver,
      factory: opts.factory,
      image: images.get(task.task.image)!,
      model: opts.model,
      ...(opts.auth.kind === 'token' ? { token: opts.auth.token } : {}),
      ...(opts.maxBudgetUsd !== undefined ? { maxBudgetUsd: opts.maxBudgetUsd } : {}),
      onTranscript: (raw) => store.writeTranscript(item, raw),
    })
    await store.writeRecord(record)
    finished += 1
    opts.log(progressLine(record, finished, manifest.plan.length))
    // A run that is not isolated invalidates the session; stop spending on it.
    if (record.isolation.length)
      abort = `isolation failed in ${record.key}: ${record.isolation.join('; ')}`
  })

  // Derived from the stored runs every time, so a resumed session scores exactly like a fresh one.
  const records = attachUndeclared(
    await store.readRecords(),
    opts.capability.manifest.permissions.shell,
    new Map(
      [...tasks].map(([key, t]) => [
        key,
        [t.task.verify.command, ...(t.task.setup ? [t.task.setup] : [])],
      ]),
    ),
  )
  const model = reportedModel(records, opts.model)
  const at = now().toISOString()
  manifest = {
    ...manifest,
    finishedAt: at,
    model: {
      requested: manifest.model.requested,
      reported: [...new Set(records.flatMap((r) => (r.model ? [r.model] : [])))],
    },
  }
  await store.writeManifest(manifest)

  const withheldReasons: string[] = []
  if (abort) withheldReasons.push(abort)
  const crossCheck = crossConditionIsolation(records, opts.driver.installedNames(opts.capability))
  if (crossCheck.length) withheldReasons.push(...crossCheck)

  const uplift: UpliftRun[] = []
  if (!opts.canaryOnly) {
    const traceBase = relative(opts.root, tracesDir(opts.root, opts.capability))
      .split(sep)
      .join(posix.sep)
    for (const s of manifest.suites) {
      const u = upliftFor(records, s, { agent, model, at, traces: `${traceBase}/${s.suite}` })
      if (u.skipped.length)
        opts.log(`  ${s.suite}: no completed runs in one condition for ${u.skipped.join(', ')}`)
      if (u.run) uplift.push(u.run)
    }
  }
  const canary = canaryFor(records, { agent, model, at, runner: opts.factory.runner })
  const result: ProveResult = {
    runId: manifest.runId,
    dir: store.dir,
    manifest,
    records,
    uplift,
    traces: 0,
  }
  if (canary) result.canary = canary

  if (!opts.writeEvidence) {
    result.withheld = 'evidence writing is off for this session'
  } else if (withheldReasons.length) {
    result.withheld = withheldReasons.join('; ')
  } else if (uplift.length === 0 && !canary) {
    result.withheld = 'no completed runs'
  } else {
    const written = await writeEvidence({
      root: opts.root,
      capability: opts.capability,
      records,
      uplift,
      ...(canary ? { canary } : {}),
      manifest,
      agent,
      model,
      tool: { name: 'sigil prove', version: opts.sigilVersion },
      now: now(),
    })
    result.evidencePath = written.path
    result.traces = written.traces
  }
  return result
}

/**
 * Isolation across conditions: every baseline run must report the same skills, and the treatment
 * must add exactly what was installed. A leak common to both conditions (the operator's own skill)
 * is caught by each driver's per-run check on HOME and plugin paths.
 */
export function crossConditionIsolation(
  records: readonly RunRecord[],
  installed: readonly string[],
): string[] {
  const skills = (r: RunRecord) => [...(r.environment?.skills ?? [])].sort().join(',')
  const done = records.filter((r) => r.status === 'done' && r.environment)
  const base = new Set(done.filter((r) => r.condition === 'baseline').map(skills))
  const problems: string[] = []
  if (base.size > 1)
    problems.push(`baseline runs saw different skill sets: ${[...base].join(' | ')}`)
  const baseline = done.find((r) => r.condition === 'baseline')?.environment?.skills ?? []
  for (const r of done.filter((x) => x.condition === 'treatment')) {
    const added = (r.environment?.skills ?? []).filter((s) => !baseline.includes(s)).sort()
    if (baseline.length && added.join(',') !== [...installed].sort().join(',')) {
      problems.push(
        `${r.key} added skills [${added.join(', ')}], expected [${installed.join(', ')}]`,
      )
    }
  }
  return problems
}

function resumeConflict(
  m: ReproManifest,
  opts: ProveOptions,
  agentVersion: string,
  conditions: Condition[],
): string | undefined {
  if (m.capability.digest !== opts.capability.digest)
    return 'the capability changed (different digest)'
  if (m.agent.id !== opts.driver.id) return `it ran ${m.agent.id}`
  if (m.agent.version !== agentVersion)
    return `it ran ${m.agent.id} ${m.agent.version}, the sandbox now has ${agentVersion}`
  if (m.model.requested !== opts.model) return `it asked for model ${m.model.requested}`
  if (m.runner !== opts.factory.runner) return `it used the ${m.runner} runner`
  if (m.conditions.join() !== conditions.join())
    return 'it ran different conditions (canary-only vs full)'
  for (const s of m.suites) {
    const now = opts.suites.find((x) => x.suite === s.suite)
    if (!now) return `suite ${s.suite} is not part of this invocation`
    if (now.digest !== s.digest) return `suite ${s.suite} changed (different digest)`
  }
  return undefined
}

export function parseKey(key: string): PlanItem {
  const m = /^(.+)\/([^/]+)\/(baseline|treatment)-(\d+)$/.exec(key)
  if (!m) throw new ProveError(`bad plan key: ${key}`)
  return { suite: m[1]!, task: m[2]!, condition: m[3] as Condition, n: Number(m[4]) }
}

function progressLine(r: RunRecord, i: number, total: number): string {
  const head = `[${String(i).padStart(String(total).length)}/${total}] ${r.key}`
  if (r.status === 'error') return `${head}  ERROR ${r.error ?? ''}`
  const flags = [
    r.passed ? 'pass' : 'fail',
    r.tampered ? 'tampered' : '',
    r.falseDone ? 'false-done' : '',
    r.timedOut ? 'timeout' : '',
    r.canary.length ? `${r.canary.length} canary` : '',
  ].filter(Boolean)
  const cost = r.costUsd !== undefined ? ` $${r.costUsd.toFixed(4)}` : ''
  return `${head}  ${flags.join(' ')}  ${r.seconds.toFixed(1)}s ${r.tokens} tok${cost}`
}
