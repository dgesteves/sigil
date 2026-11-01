import { AGENTS, type AgentId, PAYLOAD_FORMATS, type PayloadFormat } from '../core/ids.js'
import { commandAdapters, commandGaps } from './formats/command.js'
import { hookAdapters, hookGaps } from './formats/hook.js'
import { mcpAdapters, mcpGaps } from './formats/mcp.js'
import { pluginAdapters, pluginGaps } from './formats/plugin.js'
import { policyAdapters, policyGaps } from './formats/policy.js'
import { ruleAdapters, ruleGaps } from './formats/rule.js'
import { skillAdapters, skillGaps } from './formats/skill.js'
import { subagentAdapters, subagentGaps } from './formats/subagent.js'
import type { Adapter, KnownGap } from './types.js'

/**
 * The adapter registry. It is deliberately not exhaustive: a (format, agent) pair is supported only
 * when an adapter exists, a researched gap explains why not, and anything else is "not researched".
 */
export const ADAPTERS: readonly Adapter[] = [
  ...skillAdapters,
  ...ruleAdapters,
  ...commandAdapters,
  ...subagentAdapters,
  ...hookAdapters,
  ...mcpAdapters,
  ...policyAdapters,
  ...pluginAdapters,
]

/** Payload formats that are not installed into agents at all. */
const NOT_INSTALLABLE: Partial<Record<PayloadFormat, string>> = {
  tool: 'Tools are executables; Sigil lists and proves them but does not install binaries.',
  template: 'Templates are project starters, not agent configuration.',
  'task-suite': 'Task suites are used by sigil prove, not installed into agents.',
  bundle: 'A bundle is installed as its member capabilities.',
}

export const GAPS: readonly KnownGap[] = [
  ...skillGaps,
  ...ruleGaps,
  ...commandGaps,
  ...subagentGaps,
  ...hookGaps,
  ...mcpGaps,
  ...policyGaps,
  ...pluginGaps,
  ...PAYLOAD_FORMATS.flatMap((format) =>
    NOT_INSTALLABLE[format]
      ? AGENTS.map((agent) => ({ format, agent, reason: NOT_INSTALLABLE[format]! }))
      : [],
  ),
]

const byKey = new Map(ADAPTERS.map((a) => [`${a.format}:${a.agent}`, a]))
const gapByKey = new Map(GAPS.map((g) => [`${g.format}:${g.agent}`, g]))

if (byKey.size !== ADAPTERS.length) throw new Error('duplicate adapter registration')
for (const key of gapByKey.keys())
  if (byKey.has(key)) throw new Error(`${key} is both supported and a gap`)

export type Lookup =
  | { status: 'supported'; adapter: Adapter }
  | { status: 'unsupported'; gap: KnownGap }
  | { status: 'unresearched' }

export function lookup(format: PayloadFormat, agent: AgentId): Lookup {
  const adapter = byKey.get(`${format}:${agent}`)
  if (adapter) return { status: 'supported', adapter }
  const gap = gapByKey.get(`${format}:${agent}`)
  if (gap) return { status: 'unsupported', gap }
  return { status: 'unresearched' }
}

export const UNRESEARCHED =
  'Not researched yet: Sigil has not verified how this agent loads this format.'
