/**
 * Client-safe view of the registry: compact records for the field and the Oracle, plus the labels
 * and groupings every page shares. Imports only dependency-free core sources and types.
 */
import {
  AGENTS,
  type AgentId,
  CAPABILITY_TYPES,
  type CapabilityType,
  type CheckStatus,
  DOMAINS,
  type Domain,
  INDUSTRIES,
  type Industry,
  type Level,
  LIFECYCLE,
  type LifecycleStage,
  type UpliftVerdict,
} from '@core/ids'
import type { RegistryEntry, Tally } from 'sigil/core'

export interface UpliftSummary {
  agent: AgentId
  model: string
  suite: string
  delta: number
  ci95: [number, number]
  verdict: UpliftVerdict
  baseline: { passed: number; runs: number }
  treatment: { passed: number; runs: number }
  tasks: number
  at: string
}

/** One capability as the observatory sees it. Every field is copied or derived from the registry. */
export interface CapView {
  id: string
  ns: string
  slug: string
  name: string
  type: CapabilityType
  version: string
  summary: string
  /** Truncated description, for ranking. */
  text: string
  domains: Domain[]
  industries: Industry[]
  lifecycle: LifecycleStage[]
  technologies: string[]
  level: Level
  uplift: UpliftVerdict
  digest: string
  /** The uplift run that decides the verdict (harm first, then the strongest proof), if any. */
  lead?: UpliftSummary
  runs: number
  canary: CheckStatus | 'none'
  security: CheckStatus | 'none'
  targets: AgentId[]
  compiled: AgentId[]
  evaluated: AgentId[]
  /** Evidence exists but for a different digest: the payload changed after it was measured. */
  stale: boolean
}

export function pooled(tasks: readonly { baseline: Tally; treatment: Tally }[]) {
  const sum = (k: 'baseline' | 'treatment') =>
    tasks.reduce((a, t) => ({ passed: a.passed + t[k].passed, runs: a.runs + t[k].runs }), {
      passed: 0,
      runs: 0,
    })
  return { baseline: sum('baseline'), treatment: sum('treatment') }
}

export function summariseUplift(entry: RegistryEntry): UpliftSummary[] {
  const ev = entry.evidence
  // Evidence for another digest counts for nothing (AGENTS.md rule 2).
  if (!ev || ev.digest !== entry.digest) return []
  return ev.uplift.map((u) => {
    const p = pooled(u.tasks)
    return {
      agent: u.agent.id,
      model: u.model,
      suite: u.suite,
      delta: u.delta,
      ci95: u.ci95,
      verdict: u.verdict,
      baseline: p.baseline,
      treatment: p.treatment,
      tasks: u.tasks.length,
      at: u.at,
    }
  })
}

function leadOf(runs: UpliftSummary[]): UpliftSummary | undefined {
  const harm = runs.filter((r) => r.verdict === 'harmful').sort((a, b) => a.ci95[1] - b.ci95[1])
  if (harm[0]) return harm[0]
  return [...runs].sort((a, b) => b.ci95[0] - a.ci95[0])[0]
}

export function toView(entry: RegistryEntry): CapView {
  const m = entry.manifest
  const [ns, slug] = m.id.split('/') as [string, string]
  const ev = entry.evidence
  const current = ev && ev.digest === entry.digest ? ev : undefined
  const runs = summariseUplift(entry)
  const lead = leadOf(runs)
  const compat = current?.compat ?? {}
  return {
    id: m.id,
    ns,
    slug,
    name: m.name,
    type: m.type,
    version: m.version,
    summary: m.summary,
    text: (m.description ?? '').slice(0, 600),
    domains: m.domains,
    industries: m.industries,
    lifecycle: m.lifecycle,
    technologies: m.technologies,
    level: entry.level,
    uplift: entry.uplift,
    digest: entry.digest,
    ...(lead ? { lead } : {}),
    runs: runs.reduce((n, r) => n + r.baseline.runs + r.treatment.runs, 0),
    canary: current?.canary?.status ?? 'none',
    security: current?.security.status ?? 'none',
    targets: m.targets,
    compiled: AGENTS.filter((a) => compat[a]?.compiled),
    evaluated: AGENTS.filter((a) => compat[a]?.evaluated),
    stale: Boolean(ev && ev.digest !== entry.digest),
  }
}

/* --------------------------------------------------------------------------------------------- */

export const VERDICT: Record<
  UpliftVerdict,
  { label: string; tone: string; rank: number; line: string }
> = {
  proven: {
    label: 'Proven',
    tone: 'var(--flare)',
    rank: 0,
    line: 'The whole 95% interval is above zero.',
  },
  inconclusive: {
    label: 'Inconclusive',
    tone: 'var(--haze)',
    rank: 1,
    line: 'The interval crosses zero, or there are fewer than 6 runs per condition.',
  },
  'no-effect': {
    label: 'No effect',
    tone: 'var(--null)',
    rank: 2,
    line: 'The whole interval lies within ±10 percentage points.',
  },
  untested: {
    label: 'Untested',
    tone: 'var(--ash)',
    rank: 3,
    line: 'No runs exist for this digest.',
  },
  harmful: {
    label: 'Harmful',
    tone: 'var(--harm)',
    rank: 4,
    line: 'The whole interval is below zero.',
  },
}

export const LEVEL: Record<Level, { label: string; line: string }> = {
  submitted: { label: 'Submitted', line: 'In the catalog, not yet checked for this digest.' },
  validated: { label: 'Validated', line: 'Structure and static scan pass, no high findings.' },
  verified: { label: 'Verified', line: 'Validated, canary sandbox passed, maintainer approved.' },
  revoked: { label: 'Revoked', line: 'Verification withdrawn. The reason is public.' },
}

export const TYPE_LABEL: Record<CapabilityType, string> = {
  skill: 'Skill',
  agent: 'Subagent',
  rule: 'Rule',
  command: 'Command',
  workflow: 'Workflow',
  hook: 'Hook',
  'mcp-server': 'MCP server',
  tool: 'Tool',
  policy: 'Policy',
  template: 'Template',
  evaluation: 'Evaluation',
  collection: 'Collection',
}

export const AGENT_LABEL: Record<AgentId, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  cursor: 'Cursor',
  'github-copilot': 'GitHub Copilot',
  'gemini-cli': 'Gemini CLI',
  opencode: 'OpenCode',
  windsurf: 'Windsurf',
  cline: 'Cline',
  'roo-code': 'Roo Code',
  'kilo-code': 'Kilo Code',
  amp: 'Amp',
  aider: 'Aider',
  zed: 'Zed',
  junie: 'Junie',
  kiro: 'Kiro',
  goose: 'Goose',
  continue: 'Continue',
  augment: 'Augment',
  'qwen-code': 'Qwen Code',
  'factory-droid': 'Factory Droid',
  trae: 'Trae',
  warp: 'Warp',
  generic: 'Any agent (AGENTS.md)',
}

/** The agents the install line offers first. The rest are one click away. */
export const PRIMARY_AGENTS: AgentId[] = [
  'claude-code',
  'codex',
  'cursor',
  'github-copilot',
  'gemini-cli',
  'opencode',
]

/** Mirrors the groups commented in core's DOMAINS. Checked below so a new domain cannot be lost. */
export const DOMAIN_GROUPS: { id: string; label: string; domains: Domain[] }[] = [
  {
    id: 'build',
    label: 'Building software',
    domains: [
      'frontend',
      'backend',
      'mobile',
      'desktop',
      'embedded',
      'game-development',
      'systems',
      'networking',
      'api-design',
      'architecture',
      'migration',
    ],
  },
  {
    id: 'data',
    label: 'Data and AI',
    domains: [
      'databases',
      'data',
      'data-engineering',
      'data-science',
      'machine-learning',
      'ai-engineering',
      'mlops',
    ],
  },
  {
    id: 'run',
    label: 'Running software',
    domains: ['devops', 'cloud', 'platform-engineering', 'observability', 'performance'],
  },
  {
    id: 'trust',
    label: 'Quality and trust',
    domains: ['testing', 'code-review', 'security', 'compliance', 'accessibility'],
  },
  {
    id: 'around',
    label: 'Around the code',
    domains: ['design', 'developer-workflow', 'documentation', 'product', 'blockchain'],
  },
  {
    id: 'beyond',
    label: 'Beyond software',
    domains: [
      'research',
      'writing',
      'productivity',
      'business-operations',
      'marketing',
      'sales',
      'customer-support',
      'education',
    ],
  },
]

const grouped = DOMAIN_GROUPS.flatMap((g) => g.domains)
if (grouped.length !== DOMAINS.length || DOMAINS.some((d) => !grouped.includes(d))) {
  throw new Error('DOMAIN_GROUPS is out of sync with core DOMAINS')
}

export function humanize(id: string): string {
  const special: Record<string, string> = {
    'ai-engineering': 'AI engineering',
    mlops: 'MLOps',
    'api-design': 'API design',
    devops: 'DevOps',
    'e-commerce': 'E-commerce',
    saas: 'SaaS',
    'aerospace-defense': 'Aerospace and defense',
    'travel-hospitality': 'Travel and hospitality',
    'marketing-advertising': 'Marketing and advertising',
    'mcp-server': 'MCP server',
  }
  if (special[id]) return special[id]
  const s = id.replace(/-/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export { AGENTS, CAPABILITY_TYPES, DOMAINS, INDUSTRIES, LIFECYCLE }

/** Percentage points with a sign, e.g. +24. */
export function pp(x: number): string {
  const v = Math.round(x * 100)
  return `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v)}`
}

export function shortDigest(d: string, n = 12): string {
  return d.replace(/^sha256:/, '').slice(0, n)
}

export const REPO = process.env.NEXT_PUBLIC_SIGIL_REPO ?? 'dgesteves/sigil'
export const REPO_URL = `https://github.com/${REPO}`
export const CONTRIBUTE_URL = `${REPO_URL}/blob/main/CONTRIBUTING.md#submit-a-capability`
