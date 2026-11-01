import { AGENTS, type AgentId } from '../core/ids.js'
import { lookup, UNRESEARCHED } from './adapters.js'
import { AGENT_INFO } from './agents.js'
import { type AdapterResult, type CapabilityInput, info, no, type WriteOp, warn } from './types.js'

export interface AgentResult {
  agent: AgentId
  result: AdapterResult
}

export interface PlannedOp {
  op: WriteOp
  /** Agents that need this op; shared files appear once. */
  agents: AgentId[]
}

export interface CompileResult {
  capability: CapabilityInput
  results: AgentResult[]
  ops: PlannedOp[]
}

export interface CompileOptions {
  /** Whether a path exists in the target project. Defaults to "nothing exists" (export). */
  exists?: (path: string) => boolean
}

export class CompileError extends Error {}

/** Compiles one capability for several agents into a single deduplicated write plan. */
export function compile(
  cap: CapabilityInput,
  agents: readonly AgentId[],
  opts: CompileOptions = {},
): CompileResult {
  const ordered = AGENTS.filter((a) => agents.includes(a))
  const chosen = new Set<string>()
  const ctx = {
    pickDir(candidates: readonly string[]) {
      const dir = candidates.find((c) => chosen.has(c)) ?? candidates[0]!
      chosen.add(dir)
      return dir
    },
    exists: opts.exists ?? (() => false),
  }

  const results: AgentResult[] = []
  const planned = new Map<string, PlannedOp>()
  for (const agent of ordered) {
    const found = lookup(cap.manifest.payload.format, agent)
    let result: AdapterResult =
      found.status === 'supported'
        ? found.adapter.compile(cap, ctx)
        : no(found.status === 'unsupported' ? found.gap.reason : UNRESEARCHED)
    if (result.status === 'supported') {
      const extra = [
        ...(AGENT_INFO[agent].status ? [warn(AGENT_INFO[agent].status!)] : []),
        ...(cap.manifest.targets.includes(agent)
          ? []
          : [info(`The author does not list ${AGENT_INFO[agent].name} as a target.`)]),
      ]
      result = { ...result, notes: [...result.notes, ...extra] }
      for (const op of result.ops) {
        const key = identity(op)
        const prior = planned.get(key)
        if (!prior) {
          planned.set(key, { op, agents: [agent] })
        } else if (!sameContent(prior.op, op)) {
          throw new CompileError(
            `${agent} and ${prior.agents.join(', ')} both write ${op.path} with different content`,
          )
        } else {
          prior.agents.push(agent)
        }
      }
    }
    results.push({ agent, result })
  }
  return { capability: cap, results, ops: [...planned.values()] }
}

export function identity(op: WriteOp): string {
  if (op.kind === 'file') return `file:${op.path}`
  if (op.kind === 'block') return `block:${op.path}:${op.id}`
  // Appends are identified by value: two capabilities may append different hooks to one array.
  const tail = op.op === 'append' ? `:${stableJson(op.value)}` : ''
  return `json:${op.path}:${op.op}:${JSON.stringify(op.pointer)}${tail}`
}

function sameContent(a: WriteOp, b: WriteOp): boolean {
  if (a.kind === 'file' && b.kind === 'file')
    return a.content.equals(b.content) && a.mode === b.mode
  if (a.kind === 'block' && b.kind === 'block')
    return a.content === b.content && a.syntax === b.syntax
  if (a.kind === 'json' && b.kind === 'json') return stableJson(a.value) === stableJson(b.value)
  return false
}

/** JSON with sorted keys, so equal values compare equal regardless of key order. */
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`
  if (v && typeof v === 'object')
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`)
      .join(',')}}`
  return JSON.stringify(v)
}
