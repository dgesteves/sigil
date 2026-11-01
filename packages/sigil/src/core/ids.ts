/**
 * Closed vocabularies shared by the manifest, the compiler, the lab and the site.
 * Adding a value here is a spec change: bump SPEC_VERSION's minor and document it in spec/CHANGELOG.md.
 */

export const SPEC_VERSION = '1.0' as const

/**
 * First-class capability types. They are different artefacts with different risks and different ways
 * to prove them, not flavours of "skill".
 */
export const CAPABILITY_TYPES = [
  'skill', // knowledge and procedures loaded on demand (Agent Skills)
  'agent', // a specialised subagent definition
  'rule', // persistent instructions (AGENTS.md, CLAUDE.md, .mdc, copilot-instructions)
  'command', // an explicitly invoked prompt (slash commands, prompt files)
  'workflow', // a multi-step procedure spanning tools and stages
  'hook', // event-driven automation run by the agent harness
  'mcp-server', // tools and context over the Model Context Protocol
  'tool', // an executable the agent calls
  'policy', // enforceable permissions and sandbox settings
  'template', // a project starter
  'evaluation', // a task suite that measures other capabilities
  'collection', // a curated set, or a native plugin/extension pack
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
  'policy', // agent permission / sandbox settings fragment
  'task-suite', // Sigil tasks/ format
  'bundle', // collection of other capability ids
  'plugin', // a native plugin or extension pack (Claude Code plugin, Gemini CLI extension, ...)
] as const
export type PayloadFormat = (typeof PAYLOAD_FORMATS)[number]

/**
 * Agents Sigil can compile for, roughly by adoption. `generic` means AGENTS.md / plain files any agent
 * can read. An agent being listed does not mean it is supported: docs/AGENTS-MATRIX.md records which
 * formats each one really loads, with sources, and unresearched combinations compile to "unsupported".
 */
export const AGENTS = [
  'claude-code',
  'codex',
  'cursor',
  'github-copilot',
  'gemini-cli',
  'opencode',
  'windsurf',
  'cline',
  'roo-code',
  'kilo-code',
  'amp',
  'aider',
  'zed',
  'junie',
  'kiro',
  'goose',
  'continue',
  'augment',
  'qwen-code',
  'factory-droid',
  'trae',
  'warp',
  'generic',
] as const
export type AgentId = (typeof AGENTS)[number]

/** Disciplines: what kind of work a capability helps with. Industries are a separate axis. */
export const DOMAINS = [
  // Building software
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
  // Data and AI
  'databases',
  'data', // analytics and BI
  'data-engineering',
  'data-science',
  'machine-learning',
  'ai-engineering',
  'mlops',
  // Running software
  'devops',
  'cloud',
  'platform-engineering',
  'observability',
  'performance',
  // Quality and trust
  'testing',
  'code-review',
  'security',
  'compliance',
  'accessibility',
  // Around the code
  'design',
  'developer-workflow',
  'documentation',
  'product',
  'blockchain',
  // Beyond software
  'research',
  'writing',
  'productivity',
  'business-operations',
  'marketing',
  'sales',
  'customer-support',
  'education',
] as const
export type Domain = (typeof DOMAINS)[number]

/** Industries (verticals): domain knowledge and regulation that changes how the work must be done. */
export const INDUSTRIES = [
  'finance',
  'banking',
  'insurance',
  'healthcare',
  'life-sciences',
  'legal',
  'government',
  'education',
  'e-commerce',
  'retail',
  'media',
  'gaming',
  'telecommunications',
  'energy',
  'manufacturing',
  'automotive',
  'aerospace-defense',
  'logistics',
  'real-estate',
  'travel-hospitality',
  'agriculture',
  'construction',
  'human-resources',
  'marketing-advertising',
  'saas',
  'nonprofit',
  'scientific-research',
] as const
export type Industry = (typeof INDUSTRIES)[number]

/** Where in the software lifecycle a capability acts. Lets the Oracle answer "what helps me ship?". */
export const LIFECYCLE = [
  'plan',
  'design',
  'build',
  'review',
  'test',
  'secure',
  'ship',
  'operate',
  'maintain',
  'document',
] as const
export type LifecycleStage = (typeof LIFECYCLE)[number]

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
