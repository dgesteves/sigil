/**
 * Closed vocabularies shared by the manifest, the compiler, the lab and the site.
 * Adding a value here is a spec change: bump SPEC_VERSION's minor and document it in spec/CHANGELOG.md.
 */

export const SPEC_VERSION = '1.0' as const

/** Ten first-class capability types plus collections. They are different artefacts, not flavours of "skill". */
export const CAPABILITY_TYPES = [
  'skill',
  'agent',
  'rule',
  'command',
  'workflow',
  'hook',
  'mcp-server',
  'tool',
  'template',
  'evaluation',
  'collection',
] as const
export type CapabilityType = (typeof CAPABILITY_TYPES)[number]

/** Native payload formats. A capability is stored in its native format; adapters translate, they never re-author. */
export const PAYLOAD_FORMATS = [
  'agent-skill', // agentskills.io SKILL.md directory
  'subagent', // markdown + frontmatter agent definition
  'rule', // markdown + frontmatter (description, globs, alwaysApply)
  'command', // markdown prompt with $ARGUMENTS
  'hook', // hook.json + scripts
  'mcp-server', // server.json (MCP registry shape)
  'tool', // executable + usage docs
  'template', // project tree copied as-is
  'task-suite', // Sigil tasks/ format
  'bundle', // collection of other capability ids
] as const
export type PayloadFormat = (typeof PAYLOAD_FORMATS)[number]

/** Agents Sigil can compile for. `generic` means AGENTS.md / plain files any agent can read. */
export const AGENTS = [
  'claude-code',
  'codex',
  'cursor',
  'github-copilot',
  'gemini-cli',
  'opencode',
  'windsurf',
  'generic',
] as const
export type AgentId = (typeof AGENTS)[number]

export const DOMAINS = [
  'frontend',
  'backend',
  'mobile',
  'databases',
  'devops',
  'cloud',
  'ai-engineering',
  'security',
  'testing',
  'architecture',
  'data',
  'developer-workflow',
  'documentation',
  'product',
  'research',
  'writing',
  'productivity',
] as const
export type Domain = (typeof DOMAINS)[number]

/**
 * Trust ladder. Each step requires everything below it, for one immutable digest.
 * Uplift ("does it help?") is a separate verdict: a capability can be verified-safe and still do nothing.
 */
export const LEVELS = ['submitted', 'validated', 'verified', 'revoked'] as const
export type Level = (typeof LEVELS)[number]

export const UPLIFT_VERDICTS = [
  'proven',
  'no-effect',
  'harmful',
  'inconclusive',
  'untested',
] as const
export type UpliftVerdict = (typeof UPLIFT_VERDICTS)[number]

export const CHECK_STATUSES = ['pass', 'warn', 'fail', 'not-run'] as const
export type CheckStatus = (typeof CHECK_STATUSES)[number]

export const SEVERITIES = ['info', 'low', 'medium', 'high', 'critical'] as const
export type Severity = (typeof SEVERITIES)[number]
