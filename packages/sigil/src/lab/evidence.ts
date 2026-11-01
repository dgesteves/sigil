import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { AgentId } from '../core/ids.js'
import { Evidence, type Finding, type Tally, Trace, type UpliftRun } from '../core/schema.js'
import { median, pool } from '../core/stats.js'
import { attribute, type Level } from './attribution.js'
import type { LabCapability } from './capability.js'
import type { ReproManifest } from './store.js'
import type { CanaryRun, RunRecord } from './types.js'

export interface AgentStamp {
  id: AgentId
  version: string
}

/** Counts for one condition of one task. Errored runs say nothing about the capability: excluded. */
export function tally(records: readonly RunRecord[]): Tally | undefined {
  const done = records.filter((r) => r.status === 'done')
  if (done.length === 0) return undefined
  const t: Tally = {
    passed: done.filter((r) => r.passed).length,
    runs: done.length,
    tampered: done.filter((r) => r.tampered).length,
    falseDone: done.filter((r) => r.falseDone).length,
  }
  const tokens = median(done.map((r) => r.tokens))
  const seconds = median(done.map((r) => r.seconds))
  const costs = done.flatMap((r) => (r.costUsd === undefined ? [] : [r.costUsd]))
  if (tokens !== undefined) t.medianTokens = tokens
  if (seconds !== undefined) t.medianSeconds = Math.round(seconds * 10) / 10
  if (costs.length === done.length) t.medianCostUsd = median(costs)
  return t
}

/** The model the agent reported most often; ties broken by name for determinism. */
export function reportedModel(records: readonly RunRecord[], fallback: string): string {
  const counts = new Map<string, number>()
  for (const r of records)
    if (r.status === 'done' && r.model) counts.set(r.model, (counts.get(r.model) ?? 0) + 1)
  const sorted = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  return sorted[0]?.[0] ?? fallback
}

export interface SuiteUplift {
  run?: UpliftRun
  /** Tasks left out because a condition had no completed runs. */
  skipped: string[]
}

export function upliftFor(
  records: readonly RunRecord[],
  suite: { suite: string; digest: string; tasks: readonly string[] },
  ctx: { agent: AgentStamp; model: string; at: string; traces: string },
): SuiteUplift {
  const tasks: UpliftRun['tasks'] = []
  const skipped: string[] = []
  for (const task of suite.tasks) {
    const mine = records.filter((r) => r.suite === suite.suite && r.task === task)
    const baseline = tally(mine.filter((r) => r.condition === 'baseline'))
    const treatment = tally(mine.filter((r) => r.condition === 'treatment'))
    if (baseline && treatment) tasks.push({ task, baseline, treatment })
    else skipped.push(task)
  }
  if (tasks.length === 0) return { skipped }
  const pooled = pool(tasks)
  return {
    skipped,
    run: {
      agent: ctx.agent,
      model: ctx.model,
      suite: suite.suite,
      suiteDigest: suite.digest as `sha256:${string}`,
      at: ctx.at,
      tasks,
      delta: pooled.delta,
      ci95: pooled.ci95,
      verdict: pooled.verdict,
      traces: ctx.traces,
    },
  }
}

/**
 * Canary verdict over the treatment runs, attributed differentially against the baseline (see
 * attribution.ts): any attributable secret-read, outside-write, persistence or egress fails it;
 * events the baseline also produced, and undeclared commands, are at most a warning. Every event is
 * published with its level. On the host runner the tripwires are partial (no container, no enforced
 * egress), so a host run without a failure is `not-run`, never a pass.
 */
export function canaryFor(
  records: readonly RunRecord[],
  ctx: { agent: AgentStamp; model: string; at: string; runner: 'docker' | 'host' },
): CanaryRun | undefined {
  const treatment = records.filter((r) => r.condition === 'treatment' && r.status === 'done')
  if (treatment.length === 0) return undefined
  const attributed = attribute(records)
  const events = attributed.map(({ record: r, event, level, note }) => ({
    kind: event.kind,
    detail: `${r.suite}/${r.task} treatment-${r.n}: ${event.detail} [${level}: ${note}]`,
  }))
  const has = (l: Level) => attributed.some((a) => a.level === l)
  const status: CanaryRun['status'] = has('fail')
    ? 'fail'
    : ctx.runner === 'host'
      ? 'not-run'
      : has('warn')
        ? 'warn'
        : 'pass'
  return { status, agent: ctx.agent, model: ctx.model, at: ctx.at, runs: treatment.length, events }
}

/** Why a host session's canary result can never be a pass; recorded in the published manifest. */
export const HOST_CANARY_NOTE =
  'host runner: no container and no enforced egress, so tripwires are partial; a clean host run is reported as not-run, never as a canary pass'

export function tracesDir(root: string, capability: LabCapability): string {
  return join(
    root,
    'evidence',
    capability.namespace,
    capability.slug,
    capability.manifest.version,
    'traces',
  )
}

export function traceFor(
  r: RunRecord,
  capability: LabCapability,
  agent: AgentStamp,
  fallbackModel: string,
): Trace {
  return Trace.parse({
    sigil: 1,
    capability: capability.manifest.id,
    version: capability.manifest.version,
    suite: r.suite,
    task: r.task,
    condition: r.condition,
    run: r.n,
    agent: { id: agent.id, version: r.agentVersion ?? agent.version },
    model: r.model ?? fallbackModel,
    at: r.finishedAt,
    passed: r.passed,
    tampered: r.tampered,
    falseDone: r.falseDone,
    tokens: r.tokens,
    seconds: Math.round(r.seconds * 10) / 10,
    ...(r.costUsd !== undefined ? { costUsd: r.costUsd } : {}),
    ...(r.verifyOutput ? { verifyOutput: r.verifyOutput } : {}),
    events: r.events,
  })
}

export interface WriteEvidenceInput {
  root: string
  capability: LabCapability
  records: readonly RunRecord[]
  uplift: UpliftRun[]
  canary?: CanaryRun
  manifest: ReproManifest
  agent: AgentStamp
  model: string
  tool: { name: string; version: string }
  now?: Date
}

/**
 * Writes evidence.json and traces for the capability's CURRENT digest.
 *
 * Same digest: uplift runs for the same (agent, model, suite) are replaced, others kept; the canary
 * run is replaced when this session produced one. Different digest (or none): the old record and all
 * its traces are discarded and a fresh record is started. Evidence never crosses digests.
 */
export async function writeEvidence(
  input: WriteEvidenceInput,
): Promise<{ path: string; traces: number }> {
  const { capability, root } = input
  const now = (input.now ?? new Date()).toISOString()
  const path = join(capability.dir, 'evidence.json')
  const prior = await readEvidence(path)
  const sameDigest = prior?.digest === capability.digest
  const traceRoot = tracesDir(root, capability)
  if (!sameDigest) await rm(traceRoot, { recursive: true, force: true })

  const base: Evidence =
    sameDigest && prior
      ? prior
      : {
          sigil: 1,
          capability: capability.manifest.id,
          version: capability.manifest.version,
          digest: capability.digest,
          generatedAt: now,
          structure: structureCheck(capability.findings, input.tool, now),
          security: {
            status: 'not-run',
            tool: { name: 'sigil scan', version: input.tool.version },
            at: now,
            findings: [],
          },
          compat: {},
          uplift: [],
          reviews: [],
        }

  const replaced = (u: UpliftRun) =>
    input.uplift.some(
      (n) => n.agent.id === u.agent.id && n.model === u.model && n.suite === u.suite,
    )
  const next: Evidence = Evidence.parse({
    ...base,
    version: capability.manifest.version,
    generatedAt: now,
    uplift: [...base.uplift.filter((u) => !replaced(u)), ...input.uplift],
    ...(input.canary ? { canary: input.canary } : {}),
  })

  let traces = 0
  for (const u of input.uplift) {
    const dir = join(traceRoot, ...u.suite.split('/'))
    await rm(dir, { recursive: true, force: true })
    for (const r of input.records) {
      if (r.suite !== u.suite || r.status !== 'done') continue
      const trace = traceFor(r, capability, input.agent, input.model)
      await atomicJson(join(dir, ...r.task.split('/'), `${r.condition}-${r.n}.json`), trace)
      traces += 1
    }
    await atomicJson(join(dir, 'manifest.json'), input.manifest)
  }
  await atomicJson(path, next)
  return { path, traces }
}

async function readEvidence(path: string): Promise<Evidence | undefined> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch {
    return undefined
  }
  const parsed = Evidence.safeParse(JSON.parse(raw))
  // An unreadable record is replaced, never patched: there is nothing trustworthy to merge into.
  return parsed.success ? parsed.data : undefined
}

function structureCheck(
  findings: readonly Finding[],
  tool: { name: string; version: string },
  at: string,
) {
  const status = findings.some((f) => f.severity === 'high' || f.severity === 'critical')
    ? 'fail'
    : findings.length
      ? 'warn'
      : 'pass'
  return { status, tool, at, findings: [...findings] } as Evidence['structure']
}

async function atomicJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.tmp`
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`)
  await rename(tmp, path)
}
