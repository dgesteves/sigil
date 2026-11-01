import type { Evidence, TraceEvent } from '../core/schema.js'
import type { AgentEnvironment } from './agents/types.js'
import type { CanaryEvent } from './canary.js'
import type { SandboxFacts } from './sandbox/types.js'
import type { TreeChange } from './tree.js'

export const CONDITIONS = ['baseline', 'treatment'] as const
export type Condition = (typeof CONDITIONS)[number]

export interface PlanItem {
  suite: string
  task: string
  condition: Condition
  /** 1-based run number within (task, condition). */
  n: number
}

export function keyOf(p: PlanItem): string {
  return `${p.suite}/${p.task}/${p.condition}-${p.n}`
}

/**
 * Everything the lab keeps about one run, already redacted. Traces and evidence are derived from
 * these records, so a run never has to be repeated to re-publish it.
 */
export interface RunRecord extends PlanItem {
  key: string
  /** `error` = the run says nothing about the capability (setup or agent infrastructure failed). */
  status: 'done' | 'error'
  error?: string
  startedAt: string
  finishedAt: string
  passed: boolean
  verifyExit: number
  verifyOutput: string
  tampered: boolean
  tamperedFiles: string[]
  /** Protected files the agent only added to (every original line kept): recorded, not tampering. */
  touchedProtected: string[]
  claimedDone: boolean
  falseDone: boolean
  timedOut: boolean
  tokens: number
  seconds: number
  costUsd?: number
  /** As reported by the agent. */
  model?: string
  agentVersion?: string
  canary: CanaryEvent[]
  isolation: string[]
  environment?: AgentEnvironment
  /** Work-dir changes the agent made (paths only). */
  changes: TreeChange[]
  egress: { phase: string; host: string; port: number; allowed: boolean }[]
  facts?: SandboxFacts
  /** Trace events, truncated and redacted. */
  events: TraceEvent[]
}

/** core exports the CanaryRun schema but not its type; derived here to keep core untouched. */
export type CanaryRun = NonNullable<Evidence['canary']>
