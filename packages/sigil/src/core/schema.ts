import { z } from 'zod'
import {
  AGENTS,
  CAPABILITY_TYPES,
  CHECK_STATUSES,
  DOMAINS,
  INDUSTRIES,
  LEVELS,
  LIFECYCLE,
  PAYLOAD_FORMATS,
  SEVERITIES,
  UPLIFT_VERDICTS,
} from './ids.js'

/* ------------------------------------------------------------------------------------------------
 * Shared atoms
 * ---------------------------------------------------------------------------------------------- */

/** Same rules as the Agent Skills `name` field, so a skill's slug is always a valid SKILL.md name. */
export const Slug = z
  .string()
  .min(1)
  .max(64)
  .regex(
    /^[a-z0-9]+(-[a-z0-9]+)*$/,
    'lowercase letters, digits and single hyphens; no leading/trailing hyphen',
  )

/** `<namespace>/<slug>`, e.g. `react/server-components`. The namespace is a technology or a publisher. */
export const CapabilityId = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*\/[a-z0-9]+(-[a-z0-9]+)*$/, 'expected <namespace>/<slug>')

export const SemVer = z
  .string()
  .regex(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?$/,
    'expected a semantic version like 1.2.0',
  )

export const Digest = z.string().regex(/^sha256:[a-f0-9]{64}$/, 'expected sha256:<64 hex>')

export const GitSha = z.string().regex(/^[a-f0-9]{40}$/, 'expected a full 40-character commit SHA')

export const GitHubLogin = z
  .string()
  .regex(/^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/, 'expected a GitHub login')

export const Person = z.strictObject({
  github: GitHubLogin,
  name: z.string().min(1).max(100).optional(),
})

export const AgentIdSchema = z.enum(AGENTS)
export const CapabilityTypeSchema = z.enum(CAPABILITY_TYPES)
export const DomainSchema = z.enum(DOMAINS)
export const IndustrySchema = z.enum(INDUSTRIES)
export const LifecycleSchema = z.enum(LIFECYCLE)

/* ------------------------------------------------------------------------------------------------
 * Permissions: what a capability may make an agent do. Declared by the author, enforced by
 * `sigil scan` (static) and the lab's canary sandbox (behavioural). Undeclared = denied.
 * ---------------------------------------------------------------------------------------------- */

export const Permissions = z
  .strictObject({
    /** Hosts the capability's scripts or instructions contact. `[]` = no network. `*` is never allowed. */
    network: z.array(z.string().regex(/^[a-z0-9.-]+(:\d+)?$/, 'expected a hostname')).default([]),
    /** Command prefixes it runs or tells the agent to run, e.g. `git`, `pnpm test`. */
    shell: z.array(z.string().min(1).max(80)).default([]),
    /** `read`: reads the project. `write`: edits project files. Nothing outside the project is ever granted. */
    filesystem: z.enum(['none', 'read', 'write']).default('read'),
    /** Environment variables it needs (names only). Secret values never appear in a capability. */
    env: z.array(z.string().regex(/^[A-Z][A-Z0-9_]*$/)).default([]),
  })
  .default({ network: [], shell: [], filesystem: 'read', env: [] })
export type Permissions = z.infer<typeof Permissions>

/* ------------------------------------------------------------------------------------------------
 * Capability manifest: `sigil.yaml` next to the native payload.
 * ---------------------------------------------------------------------------------------------- */

export const Source = z.strictObject({
  /** Upstream repository for capabilities Sigil lists but does not host. */
  repo: z
    .url()
    .regex(/^https:\/\/github\.com\/[^/]+\/[^/]+$/, 'expected https://github.com/<owner>/<repo>'),
  /** Pinned commit. Verification is bound to content, so floating refs are rejected. */
  ref: GitSha,
  /** Directory inside the repo that holds the payload. */
  path: z.string().min(1).default('.'),
})

export const Payload = z.strictObject({
  format: z.enum(PAYLOAD_FORMATS),
  /** Entry file relative to the capability directory (or to `source.path` for external capabilities). */
  entry: z.string().min(1),
})

export const ProofSpec = z.strictObject({
  /** Task suites (paths under tasks/) that measure this capability's effect. */
  suites: z.array(z.string().regex(/^[a-z0-9-]+(\/[a-z0-9-]+)*$/)).default([]),
})

const TYPE_FORMATS: Record<
  (typeof CAPABILITY_TYPES)[number],
  readonly (typeof PAYLOAD_FORMATS)[number][]
> = {
  skill: ['agent-skill'],
  agent: ['subagent'],
  rule: ['rule'],
  command: ['command'],
  workflow: ['agent-skill', 'command', 'bundle'],
  hook: ['hook'],
  'mcp-server': ['mcp-server'],
  tool: ['tool', 'agent-skill'],
  policy: ['policy'],
  template: ['template'],
  evaluation: ['task-suite'],
  collection: ['bundle', 'plugin'],
}

export const Manifest = z
  .strictObject({
    sigil: z.literal(1),
    id: CapabilityId,
    type: CapabilityTypeSchema,
    version: SemVer,
    name: z.string().min(2).max(80),
    /** One line shown in search results and the CLI. */
    summary: z.string().min(10).max(160),
    description: z.string().min(20).max(4000).optional(),
    domains: z.array(DomainSchema).min(1).max(4),
    /** Verticals whose rules or domain knowledge the capability encodes. Empty = industry-agnostic. */
    industries: z.array(IndustrySchema).max(6).default([]),
    /** Lifecycle stages where it acts. */
    lifecycle: z.array(LifecycleSchema).max(4).default([]),
    /** Lowercase technology tags: languages, frameworks, products. */
    technologies: z.array(Slug).max(12).default([]),
    license: z.string().min(2).max(64),
    authors: z.array(Person).min(1),
    maintainers: z.array(Person).default([]),
    /** Present only for third-party capabilities that Sigil evaluates but does not host. */
    source: Source.optional(),
    payload: Payload,
    /** Agents the author intends to support. Sigil reports which ones were actually compiled and tested. */
    targets: z.array(AgentIdSchema).min(1),
    permissions: Permissions,
    proof: ProofSpec.default({ suites: [] }),
    /** For collections: the capabilities they bundle. */
    includes: z.array(CapabilityId).default([]),
    /** Known limitations, shown on the capability page. Honesty is a feature. */
    limitations: z.array(z.string().min(5).max(300)).default([]),
  })
  .superRefine((m, ctx) => {
    if (!TYPE_FORMATS[m.type].includes(m.payload.format)) {
      ctx.addIssue({
        code: 'custom',
        path: ['payload', 'format'],
        message: `type "${m.type}" expects payload.format ${TYPE_FORMATS[m.type].map((f) => `"${f}"`).join(' or ')}`,
      })
    }
    if (m.payload.format === 'bundle' && m.includes.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['includes'],
        message: 'a bundle must include at least one capability',
      })
    }
    if (m.type !== 'collection' && m.includes.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['includes'],
        message: 'only collections may include other capabilities',
      })
    }
    if (m.permissions.network.includes('*')) {
      ctx.addIssue({
        code: 'custom',
        path: ['permissions', 'network'],
        message: 'wildcard network access is never granted',
      })
    }
  })
export type Manifest = z.infer<typeof Manifest>
export type ManifestInput = z.input<typeof Manifest>

/* ------------------------------------------------------------------------------------------------
 * Evidence record: generated by Sigil tooling, never written by hand. One record per digest.
 * ---------------------------------------------------------------------------------------------- */

export const Finding = z.strictObject({
  rule: z.string().min(1), // e.g. SIG-SEC-004
  severity: z.enum(SEVERITIES),
  message: z.string().min(1),
  file: z.string().optional(),
  line: z.number().int().positive().optional(),
  /** OWASP Agentic Skills Top 10 id when the rule maps to one, e.g. AST01. */
  owasp: z
    .string()
    .regex(/^AST\d{2}$/)
    .optional(),
})
export type Finding = z.infer<typeof Finding>

export const ToolStamp = z.strictObject({ name: z.string(), version: z.string() })

export const Check = z.strictObject({
  status: z.enum(CHECK_STATUSES),
  tool: ToolStamp,
  at: z.iso.datetime(),
  findings: z.array(Finding).default([]),
})
export type Check = z.infer<typeof Check>

/** Pass counts for one condition. Rates are derived, never stored, so they cannot drift from the counts. */
export const Tally = z.strictObject({
  passed: z.number().int().nonnegative(),
  runs: z.number().int().positive(),
  /** Runs where the agent edited or deleted the task's protected tests. Counted as failures. */
  tampered: z.number().int().nonnegative().default(0),
  /** Runs where the agent claimed success but the verifier failed. */
  falseDone: z.number().int().nonnegative().default(0),
  medianTokens: z.number().nonnegative().optional(),
  medianSeconds: z.number().nonnegative().optional(),
  medianCostUsd: z.number().nonnegative().optional(),
})
export type Tally = z.infer<typeof Tally>

export const TaskResult = z.strictObject({
  task: z.string(),
  baseline: Tally,
  treatment: Tally,
})

export const Interval = z.tuple([z.number(), z.number()])

export const UpliftRun = z.strictObject({
  agent: z.strictObject({ id: AgentIdSchema, version: z.string() }),
  model: z.string(),
  suite: z.string(),
  /** Digest of the task suite, so results are tied to exact tasks. */
  suiteDigest: Digest,
  at: z.iso.datetime(),
  tasks: z.array(TaskResult).min(1),
  /** Pooled treatment minus baseline pass rate, with a 95% Newcombe interval. */
  delta: z.number().min(-1).max(1),
  ci95: Interval,
  verdict: z.enum(UPLIFT_VERDICTS),
  /** Where the raw traces live (relative to the repo), so anyone can audit the runs. */
  traces: z.string().optional(),
})
export type UpliftRun = z.infer<typeof UpliftRun>

export const CanaryRun = z.strictObject({
  status: z.enum(CHECK_STATUSES),
  agent: z.strictObject({ id: AgentIdSchema, version: z.string() }),
  model: z.string(),
  at: z.iso.datetime(),
  runs: z.number().int().nonnegative(),
  /** Honeytoken reads, blocked egress attempts and other tripwires, in order. */
  events: z
    .array(
      z.strictObject({
        kind: z.enum([
          'secret-read',
          'egress',
          'outside-write',
          'persistence',
          'undeclared-command',
        ]),
        detail: z.string(),
      }),
    )
    .default([]),
})

export const CompatEntry = z.strictObject({
  compiled: z.boolean(),
  /** Measured in the lab with this agent (an uplift or canary run exists). */
  evaluated: z.boolean(),
  notes: z.string().optional(),
})

export const Review = z.strictObject({
  by: GitHubLogin,
  at: z.iso.datetime(),
  decision: z.enum(['approved', 'changes-requested', 'revoked']),
  notes: z.string().max(2000).optional(),
})

export const Evidence = z.strictObject({
  sigil: z.literal(1),
  capability: CapabilityId,
  version: SemVer,
  digest: Digest,
  generatedAt: z.iso.datetime(),
  structure: Check,
  security: Check,
  canary: CanaryRun.optional(),
  compat: z.partialRecord(AgentIdSchema, CompatEntry).default({}),
  uplift: z.array(UpliftRun).default([]),
  reviews: z.array(Review).default([]),
  /** Set when verification is withdrawn; the reason is public. */
  revoked: z.strictObject({ at: z.iso.datetime(), reason: z.string().min(10) }).optional(),
})
export type Evidence = z.infer<typeof Evidence>

/* ------------------------------------------------------------------------------------------------
 * Task: one unit of the proving ground. `tasks/<suite>/<task>/task.yaml`
 * ---------------------------------------------------------------------------------------------- */

export const Task = z.strictObject({
  sigil: z.literal(1),
  id: Slug,
  title: z.string().min(5).max(120),
  /** What the agent is asked to do. Written like a real user request, never mentioning the capability. */
  prompt: z.string().min(20).max(4000),
  /** Starting repository, relative to the task directory. */
  repo: z.string().default('repo'),
  /** Hidden verifier, copied in only after the agent stops, so it cannot be read or edited. */
  verify: z.strictObject({
    dir: z.string().default('verify'),
    /** Command run in the repo root after the verifier is copied in. Exit code 0 = pass. */
    command: z.string().min(1),
    timeoutSeconds: z.number().int().positive().max(1800).default(300),
  }),
  /** Files inside the starting repo the agent must not modify (tamper detection). Globs. */
  protected: z.array(z.string()).default([]),
  /** Container image for the sandbox, pinned by digest in CI. */
  image: z.string().default('node:24-bookworm'),
  /** Setup command run before the agent starts (install deps), outside the timed window. */
  setup: z.string().optional(),
  timeoutSeconds: z.number().int().positive().max(3600).default(900),
  tags: z.array(Slug).default([]),
})
export type Task = z.infer<typeof Task>

/* ------------------------------------------------------------------------------------------------
 * Registry entry: what `sigil build-registry` emits for the site, the CLI and the MCP server.
 * ---------------------------------------------------------------------------------------------- */

export const RegistryEntry = z.strictObject({
  manifest: Manifest,
  digest: Digest,
  /** Path of the capability directory relative to the repo root. */
  path: z.string(),
  level: z.enum(LEVELS),
  uplift: z.enum(UPLIFT_VERDICTS),
  evidence: Evidence.optional(),
  files: z.array(z.strictObject({ path: z.string(), sha256: z.string(), bytes: z.number().int() })),
})
export type RegistryEntry = z.infer<typeof RegistryEntry>

export const Registry = z.strictObject({
  sigil: z.literal(1),
  generatedAt: z.iso.datetime(),
  commit: z.string().optional(),
  capabilities: z.array(RegistryEntry),
})
export type Registry = z.infer<typeof Registry>

/* ------------------------------------------------------------------------------------------------
 * Trace: one recorded agent run, written by the lab, replayed by the site's proof theater.
 * `evidence/<namespace>/<slug>/<version>/traces/<suite>/<task>/<condition>-<n>.json`
 * Text is truncated and secrets are redacted before a trace is written.
 * ---------------------------------------------------------------------------------------------- */

export const TraceEvent = z.strictObject({
  /** Milliseconds since the agent started. */
  t: z.number().nonnegative(),
  kind: z.enum(['assistant', 'tool-call', 'tool-result', 'system', 'verify', 'canary']),
  /** Tool name for tool-call/tool-result, e.g. Bash, Edit, Read. */
  tool: z.string().optional(),
  /** Human-readable content, truncated to 2,000 characters. */
  text: z.string().max(2000),
  ok: z.boolean().optional(),
})
export type TraceEvent = z.infer<typeof TraceEvent>

export const Trace = z.strictObject({
  sigil: z.literal(1),
  capability: CapabilityId,
  version: SemVer,
  suite: z.string(),
  task: z.string(),
  condition: z.enum(['baseline', 'treatment']),
  run: z.number().int().positive(),
  agent: z.strictObject({ id: AgentIdSchema, version: z.string() }),
  model: z.string(),
  at: z.iso.datetime(),
  passed: z.boolean(),
  tampered: z.boolean(),
  falseDone: z.boolean(),
  tokens: z.number().nonnegative(),
  seconds: z.number().nonnegative(),
  costUsd: z.number().nonnegative().optional(),
  /** Verifier output tail, so a failure can be understood without re-running. */
  verifyOutput: z.string().max(4000).optional(),
  events: z.array(TraceEvent),
})
export type Trace = z.infer<typeof Trace>
