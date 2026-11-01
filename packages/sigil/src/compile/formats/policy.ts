import { z } from 'zod'
import { tomlBasic } from '../text.js'
import {
  type Adapter,
  type CapabilityInput,
  entryText,
  fileOp,
  type KnownGap,
  no,
  ok,
  slugOf,
  type WriteOp,
  warn,
} from '../types.js'

/* ------------------------------------------------------------------------------------------------
 * Sigil policy payload: `policy.json`. A policy can only make an agent more careful: it denies or
 * asks, and has no allow list, because a third-party capability must never be able to widen what
 * an agent may do. `read` entries are project-relative globs; `shell` entries are command prefixes.
 * ---------------------------------------------------------------------------------------------- */

const Glob = z
  .string()
  .min(1)
  .max(200)
  .refine(
    (g) => !g.startsWith('/') && !g.split('/').includes('..') && !/[()\n]/.test(g),
    'expected a project-relative glob',
  )
const Prefix = z
  .string()
  .min(1)
  .max(80)
  .refine(
    (p) => p.trim() === p && !/[()\n*]/.test(p),
    'expected a plain command prefix such as "git push"',
  )

const Rules = z.strictObject({
  read: z.array(Glob).default([]),
  shell: z.array(Prefix).default([]),
})

export const PolicySpec = z
  .strictObject({ deny: Rules.optional(), ask: Rules.optional() })
  .refine(
    (p) => [p.deny, p.ask].some((r) => r && (r.read.length || r.shell.length)),
    'policy.json has no rules',
  )
export type PolicySpec = z.infer<typeof PolicySpec>

export function loadPolicy(cap: CapabilityInput): PolicySpec | string {
  let json: unknown
  try {
    json = JSON.parse(entryText(cap))
  } catch (e) {
    return `${cap.manifest.payload.entry} is not valid JSON: ${(e as Error).message}`
  }
  if (json && typeof json === 'object' && 'allow' in json)
    return 'policies cannot allow anything; only deny and ask rules are installed'
  const parsed = PolicySpec.safeParse(json)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!
    return `${cap.manifest.payload.entry}: ${issue.path.join('.') || '(root)'}: ${issue.message}`
  }
  return parsed.data
}

const empty = { read: [] as string[], shell: [] as string[] }

function policyAdapter(
  agent: Adapter['agent'],
  target: string,
  sources: string[],
  build: (p: PolicySpec, cap: CapabilityInput) => ReturnType<Adapter['compile']>,
): Adapter {
  return {
    format: 'policy',
    agent,
    target,
    sources,
    compile(cap) {
      const p = loadPolicy(cap)
      return typeof p === 'string' ? no(`Cannot install this policy: ${p}.`) : build(p, cap)
    },
  }
}

export const policyAdapters: Adapter[] = [
  policyAdapter(
    'claude-code',
    '.claude/settings.json (permissions.deny / permissions.ask)',
    ['https://code.claude.com/docs/en/permissions'],
    (p) => {
      const ops: WriteOp[] = []
      for (const decision of ['deny', 'ask'] as const) {
        const r = p[decision] ?? empty
        // A leading "/" anchors a project settings rule at the project root.
        const rules = [
          ...r.read.map((g) => `Read(/${g})`),
          ...r.shell.flatMap((s) => [`Bash(${s})`, `Bash(${s} *)`]),
        ]
        for (const rule of rules)
          ops.push({
            kind: 'json',
            path: '.claude/settings.json',
            op: 'append',
            pointer: ['permissions', decision],
            value: rule,
          })
      }
      return ok(ops)
    },
  ),
  policyAdapter(
    'cursor',
    '.cursor/cli.json (permissions.deny)',
    ['https://cursor.com/docs/cli/reference/permissions'],
    (p) => {
      if (p.ask && (p.ask.read.length || p.ask.shell.length))
        return no('Cursor CLI permissions have allow and deny lists only; this policy asks.')
      const deny = p.deny ?? empty
      const multi = deny.shell.find((s) => s.includes(' '))
      if (multi)
        return no(
          `Cursor CLI matches shell rules on the command name only, so "${multi}" cannot be expressed without denying more.`,
        )
      const rules = [...deny.read.map((g) => `Read(${g})`), ...deny.shell.map((s) => `Shell(${s})`)]
      return ok(
        rules.map((value) => ({
          kind: 'json',
          path: '.cursor/cli.json',
          op: 'append',
          pointer: ['permissions', 'deny'],
          value,
        })),
        [
          warn(
            'These permissions apply to the Cursor CLI; the editor agent does not document .cursor/cli.json.',
          ),
        ],
      )
    },
  ),
  policyAdapter(
    'codex',
    '.codex/rules/<slug>.rules',
    ['https://learn.chatgpt.com/docs/agent-configuration/rules'],
    (p, cap) => {
      if ([p.deny, p.ask].some((r) => r?.read.length))
        return no('Codex rules govern commands only; this policy restricts file reads.')
      const lines: string[] = []
      for (const [decision, rules] of [
        ['forbidden', p.deny],
        ['prompt', p.ask],
      ] as const) {
        for (const s of rules?.shell ?? []) {
          const pattern = s.split(/\s+/).map(tomlBasic).join(', ')
          lines.push(
            `prefix_rule(pattern=[${pattern}], decision="${decision}", justification=${tomlBasic(`Installed by Sigil from ${cap.manifest.id}`)})`,
          )
        }
      }
      return ok(
        [fileOp(`.codex/rules/${slugOf(cap)}.rules`, `${lines.join('\n')}\n`)],
        [warn('Codex loads project rules only for trusted projects.')],
      )
    },
  ),
  policyAdapter(
    'opencode',
    'opencode.json (permission.bash)',
    ['https://opencode.ai/docs/permissions/'],
    (p) => {
      if ([p.deny, p.ask].some((r) => r?.read.length))
        return no(
          'OpenCode documents patterns for bash permissions only; this policy restricts file reads.',
        )
      const ops: WriteOp[] = []
      for (const [decision, rules] of [
        ['deny', p.deny],
        ['ask', p.ask],
      ] as const) {
        for (const s of rules?.shell ?? []) {
          for (const pattern of [s, `${s} *`])
            ops.push({
              kind: 'json',
              path: 'opencode.json',
              op: 'set',
              pointer: ['permission', 'bash', pattern],
              value: decision,
            })
        }
      }
      return ok(ops, [
        warn(
          'OpenCode applies the last matching permission rule; Sigil appends its rules after yours so they take effect.',
        ),
      ])
    },
  ),
]

export const policyGaps: KnownGap[] = [
  {
    format: 'policy',
    agent: 'gemini-cli',
    reason: 'Gemini CLI documents workspace policies (.gemini/policies) as non-functional.',
    sources: ['https://geminicli.com/docs/reference/policy-engine/'],
  },
  {
    format: 'policy',
    agent: 'github-copilot',
    reason:
      'Copilot CLI ignores permission keys in repository settings; tool permissions are user-level.',
    sources: [
      'https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference',
    ],
  },
]
