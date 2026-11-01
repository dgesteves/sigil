import { AGENTS, type AgentId, type PayloadFormat } from '../core/ids.js'
import { lookup } from './adapters.js'
import { AGENT_INFO } from './agents.js'

/** Formats an agent can be configured with. The rest (tools, templates, suites) are never installed. */
export const INSTALL_FORMATS = [
  'agent-skill',
  'rule',
  'command',
  'subagent',
  'hook',
  'mcp-server',
  'policy',
  'plugin',
] as const satisfies readonly PayloadFormat[]

export const FORMAT_LABELS: Record<(typeof INSTALL_FORMATS)[number], string> = {
  'agent-skill': 'Skills',
  rule: 'Rules',
  command: 'Commands',
  subagent: 'Subagents',
  hook: 'Hooks',
  'mcp-server': 'MCP',
  policy: 'Policy',
  plugin: 'Plugin',
}

export interface MatrixCell {
  format: PayloadFormat
  agent: AgentId
  status: 'supported' | 'unsupported' | 'unresearched'
  target?: string
  reason?: string
}

export function supportMatrix(): MatrixCell[] {
  return INSTALL_FORMATS.flatMap((format) =>
    AGENTS.map((agent): MatrixCell => {
      const l = lookup(format, agent)
      if (l.status === 'supported')
        return { format, agent, status: 'supported', target: l.adapter.target }
      if (l.status === 'unsupported')
        return { format, agent, status: 'unsupported', reason: l.gap.reason }
      return { format, agent, status: 'unresearched' }
    }),
  )
}

export function matrixCounts(cells = supportMatrix()): Record<MatrixCell['status'], number> {
  const counts = { supported: 0, unsupported: 0, unresearched: 0 }
  for (const c of cells) counts[c.status]++
  return counts
}

/**
 * The summary table in docs/AGENTS-MATRIX.md, generated from the adapters so the published claims
 * cannot drift from what the code does (a test compares them).
 */
export function renderSummaryTable(): string {
  const cells = supportMatrix()
  const mark = { supported: 'yes', unsupported: 'no', unresearched: '?' }
  const header = `| Agent | ${INSTALL_FORMATS.map((f) => FORMAT_LABELS[f]).join(' | ')} |`
  const rule = `| --- | ${INSTALL_FORMATS.map(() => ':-:').join(' | ')} |`
  const rows = AGENTS.map((agent) => {
    const marks = INSTALL_FORMATS.map(
      (format) => mark[cells.find((c) => c.agent === agent && c.format === format)!.status],
    )
    return `| ${AGENT_INFO[agent].name} | ${marks.join(' | ')} |`
  })
  const n = matrixCounts(cells)
  return [
    header,
    rule,
    ...rows,
    '',
    `${n.supported} supported, ${n.unsupported} unsupported, ${n.unresearched} not researched.`,
  ].join('\n')
}
