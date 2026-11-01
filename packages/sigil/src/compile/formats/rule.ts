import type { AgentId } from '../../core/ids.js'
import { globsOf, readDocument, stringField, writeDocument } from '../text.js'
import {
  type Adapter,
  type AdapterResult,
  type CapabilityInput,
  type CompileContext,
  entryText,
  fileOp,
  type KnownGap,
  type Note,
  no,
  ok,
  slugOf,
  warn,
} from '../types.js'

/**
 * A Sigil rule is markdown with Cursor-style frontmatter (`description`, `globs`, `alwaysApply`),
 * because that is the richest activation model in use. Each agent gets the same activation in its
 * own fields; where an agent cannot express it, the rule loads always (with a warning) or, for
 * manual-only rules, is reported unsupported rather than silently promoted.
 */
export type Activation =
  | { mode: 'always'; description?: string }
  | { mode: 'files'; globs: string[]; description?: string }
  | { mode: 'agent'; description: string }
  | { mode: 'manual' }

export interface ParsedRule {
  activation: Activation
  body: string
}

export function parseRule(text: string): ParsedRule {
  const { data, body } = readDocument(text)
  const description = stringField(data, 'description')
  const globs = globsOf(data)
  const d = description ? { description } : {}
  if (data.alwaysApply === true) return { activation: { mode: 'always', ...d }, body }
  if (globs.length) return { activation: { mode: 'files', globs, ...d }, body }
  if (description) return { activation: { mode: 'agent', description }, body }
  return { activation: { mode: 'manual' }, body }
}

type Translate = (rule: ParsedRule, cap: CapabilityInput, ctx: CompileContext) => AdapterResult

function rule(agent: AgentId, target: string, sources: string[], translate: Translate): Adapter {
  return {
    format: 'rule',
    agent,
    target,
    sources,
    compile(cap, ctx) {
      return translate(parseRule(entryText(cap)), cap, ctx)
    },
  }
}

const path = (pattern: string, cap: CapabilityInput) => pattern.replace('<slug>', slugOf(cap))

/** For agents whose rules are always on: scope is dropped with a warning, manual rules are refused. */
function alwaysOn(agent: string, r: ParsedRule): { notes: Note[] } | { refused: string } {
  const a = r.activation
  if (a.mode === 'manual')
    return {
      refused: `${agent} has no manually attached rules; this rule would load in every session.`,
    }
  if (a.mode === 'files')
    return {
      notes: [
        warn(
          `${agent} cannot scope rules to files; this rule loads for every file, not only ${a.globs.join(', ')}.`,
        ),
      ],
    }
  if (a.mode === 'agent')
    return {
      notes: [warn(`${agent} cannot load rules on demand; this rule loads in every session.`)],
    }
  return { notes: [] }
}

function alwaysOnFile(
  agent: AgentId,
  name: string,
  target: string,
  sources: string[],
  /** A file that, when present, makes the agent ignore this rules folder. */
  exclusive?: string,
): Adapter {
  return rule(agent, target, sources, (r, cap, ctx) => {
    const res = alwaysOn(name, r)
    if ('refused' in res) return no(res.refused)
    const notes = [...res.notes]
    if (exclusive && ctx.exists(exclusive))
      notes.push(
        warn(`${name} uses ${exclusive} exclusively when it exists, so it will not see this rule.`),
      )
    return ok([fileOp(path(target, cap), r.body)], notes)
  })
}

/* ------------------------------------------------------------------------------------------------
 * AGENTS.md and GEMINI.md: shared files, so the rule goes in a marked block that remove takes out.
 * ---------------------------------------------------------------------------------------------- */

/** Files an agent reads instead of AGENTS.md when they exist (first match wins). */
const SHADOWS: Partial<Record<AgentId, string[]>> = {
  zed: [
    '.rules',
    '.cursorrules',
    '.windsurfrules',
    '.clinerules',
    '.github/copilot-instructions.md',
    'AGENT.md',
  ],
  warp: ['WARP.md'],
}
/** Agents that read CLAUDE.md only while AGENTS.md is absent. */
const CLAUDE_FALLBACK = new Set<AgentId>(['opencode', 'amp', 'zed'])

function blockRule(
  agent: AgentId,
  name: string,
  file: 'AGENTS.md' | 'GEMINI.md',
  sources: string[],
): Adapter {
  return rule(agent, file, sources, (r, cap, ctx) => {
    const res = alwaysOn(name, r)
    if ('refused' in res) return no(res.refused)
    const notes = [...res.notes]
    const shadow = SHADOWS[agent]?.find((p) => ctx.exists(p))
    if (shadow)
      notes.push(
        warn(`${name} reads ${shadow} instead of AGENTS.md, so it will not see this rule.`),
      )
    if (
      file === 'AGENTS.md' &&
      CLAUDE_FALLBACK.has(agent) &&
      !ctx.exists('AGENTS.md') &&
      ctx.exists('CLAUDE.md')
    )
      notes.push(
        warn(
          `${name} reads CLAUDE.md only while AGENTS.md is absent; creating AGENTS.md makes it stop reading CLAUDE.md.`,
        ),
      )
    return ok(
      [
        {
          kind: 'block',
          path: file,
          syntax: 'markdown',
          id: cap.manifest.id,
          content: r.body.trim(),
        },
      ],
      notes,
    )
  })
}

const CURSOR_LIKE = (r: ParsedRule) => {
  const a = r.activation
  return {
    description: 'description' in a ? a.description : undefined,
    globs: a.mode === 'files' ? a.globs.join(',') : undefined,
    alwaysApply: a.mode === 'always',
  }
}

export const ruleAdapters: Adapter[] = [
  rule(
    'claude-code',
    '.claude/rules/<slug>.md',
    ['https://code.claude.com/docs/en/memory'],
    (r, cap) => {
      const a = r.activation
      if (a.mode === 'manual')
        return no(
          'Claude Code has no manually attached rules; this rule would load in every session.',
        )
      const notes =
        a.mode === 'agent'
          ? [warn('Claude Code cannot load rules on demand; this rule loads in every session.')]
          : []
      const content = writeDocument({ paths: a.mode === 'files' ? a.globs : undefined }, r.body)
      return ok([fileOp(path('.claude/rules/<slug>.md', cap), content)], notes)
    },
  ),
  rule('cursor', '.cursor/rules/<slug>.mdc', ['https://cursor.com/docs/rules'], (r, cap) =>
    ok([fileOp(path('.cursor/rules/<slug>.mdc', cap), writeDocument(CURSOR_LIKE(r), r.body))]),
  ),
  rule(
    'github-copilot',
    '.github/instructions/<slug>.instructions.md',
    [
      'https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions',
      'https://code.visualstudio.com/docs/copilot/customization/custom-instructions',
    ],
    (r, cap) => {
      const a = r.activation
      const notes: Note[] = []
      if (a.mode === 'agent' || a.mode === 'manual')
        notes.push(
          warn(
            a.mode === 'agent'
              ? 'Only VS Code loads instructions on demand by description; the cloud agent and Copilot CLI apply them only through applyTo.'
              : 'Without applyTo the file is attached manually in VS Code; the cloud agent and Copilot CLI ignore it.',
          ),
        )
      const applyTo =
        a.mode === 'always' ? '**' : a.mode === 'files' ? a.globs.join(',') : undefined
      const data = { description: 'description' in a ? a.description : undefined, applyTo }
      return ok(
        [
          fileOp(
            path('.github/instructions/<slug>.instructions.md', cap),
            writeDocument(data, r.body),
          ),
        ],
        notes,
      )
    },
  ),
  rule(
    'windsurf',
    '.windsurf/rules/<slug>.md',
    ['https://docs.devin.ai/desktop/cascade/memories'],
    (r, cap) => {
      const a = r.activation
      if (a.mode === 'files' && a.globs.length > 1)
        return no('Windsurf documents a single glob per rule; this rule has several.')
      if (r.body.length > 12_000) return no('Windsurf rule files are limited to 12,000 characters.')
      const data =
        a.mode === 'always'
          ? { trigger: 'always_on' }
          : a.mode === 'files'
            ? { trigger: 'glob', globs: a.globs[0] }
            : a.mode === 'agent'
              ? { trigger: 'model_decision', description: a.description }
              : { trigger: 'manual' }
      return ok([fileOp(path('.windsurf/rules/<slug>.md', cap), writeDocument(data, r.body))])
    },
  ),
  rule(
    'cline',
    '.cline/rules/<slug>.md',
    ['https://docs.cline.bot/customization/cline-rules.md'],
    (r, cap) => {
      const a = r.activation
      if (a.mode === 'manual')
        return no('Cline has no manually attached rules; this rule would load in every session.')
      const notes =
        a.mode === 'agent'
          ? [warn('Cline cannot load rules on demand; this rule loads in every session.')]
          : []
      const content = writeDocument({ paths: a.mode === 'files' ? a.globs : undefined }, r.body)
      return ok([fileOp(path('.cline/rules/<slug>.md', cap), content)], notes)
    },
  ),
  alwaysOnFile('roo-code', 'Roo Code', '.roo/rules/<slug>.md', [
    'https://roocodeinc.github.io/Roo-Code/features/custom-instructions',
  ]),
  alwaysOnFile(
    'junie',
    'Junie',
    '.junie/rules/<slug>.md',
    ['https://junie.jetbrains.com/docs/guidelines-and-memory.html'],
    '.junie/AGENTS.md',
  ),
  rule('kiro', '.kiro/steering/<slug>.md', ['https://kiro.dev/docs/steering/'], (r, cap) => {
    const a = r.activation
    const data =
      a.mode === 'always'
        ? { inclusion: 'always' }
        : a.mode === 'files'
          ? {
              inclusion: 'fileMatch',
              fileMatchPattern: a.globs.length === 1 ? a.globs[0] : a.globs,
            }
          : a.mode === 'agent'
            ? { inclusion: 'auto', name: slugOf(cap), description: a.description }
            : { inclusion: 'manual' }
    return ok([fileOp(path('.kiro/steering/<slug>.md', cap), writeDocument(data, r.body))])
  }),
  rule(
    'continue',
    '.continue/rules/<slug>.md',
    ['https://docs.continue.dev/customize/deep-dives/rules'],
    (r, cap) => {
      const a = r.activation
      if (a.mode === 'manual') return no('Continue does not document manually attached rules.')
      const data = { name: cap.manifest.name, ...CURSOR_LIKE(r) }
      return ok([fileOp(path('.continue/rules/<slug>.md', cap), writeDocument(data, r.body))])
    },
  ),
  rule(
    'augment',
    '.augment/rules/<slug>.md',
    ['https://docs.augmentcode.com/cli/rules.md'],
    (r, cap) => {
      const a = r.activation
      const notes =
        a.mode === 'files'
          ? [
              warn(
                `Augment cannot scope rules to files; this rule loads for every file, not only ${a.globs.join(', ')}.`,
              ),
            ]
          : []
      const data =
        a.mode === 'agent'
          ? { type: 'agent_requested', description: a.description }
          : a.mode === 'manual'
            ? { type: 'manual' }
            : { type: 'always_apply' }
      return ok([fileOp(path('.augment/rules/<slug>.md', cap), writeDocument(data, r.body))], notes)
    },
  ),
  rule(
    'qwen-code',
    '.qwen/rules/<slug>.md',
    ['https://qwenlm.github.io/qwen-code-docs/en/users/features/rules/'],
    (r, cap) => {
      const a = r.activation
      if (a.mode === 'manual')
        return no(
          'Qwen Code has no manually attached rules; this rule would load in every session.',
        )
      const notes = [warn('Qwen Code loads .qwen/rules/ only in trusted workspaces.')]
      if (a.mode === 'agent')
        notes.push(warn('Qwen Code cannot load rules on demand; this rule loads in every session.'))
      const data = {
        description: 'description' in a ? a.description : undefined,
        paths: a.mode === 'files' ? a.globs : undefined,
      }
      return ok([fileOp(path('.qwen/rules/<slug>.md', cap), writeDocument(data, r.body))], notes)
    },
  ),
  rule('trae', '.trae/rules/<slug>.md', ['https://docs.trae.ai/ide/rules'], (r, cap) =>
    ok([fileOp(path('.trae/rules/<slug>.md', cap), writeDocument(CURSOR_LIKE(r), r.body))]),
  ),
  blockRule('codex', 'Codex', 'AGENTS.md', [
    'https://learn.chatgpt.com/docs/agent-configuration/agents-md',
  ]),
  blockRule('gemini-cli', 'Gemini CLI', 'GEMINI.md', ['https://geminicli.com/docs/cli/gemini-md/']),
  blockRule('opencode', 'OpenCode', 'AGENTS.md', ['https://opencode.ai/docs/rules/']),
  blockRule('kilo-code', 'Kilo Code', 'AGENTS.md', ['https://kilo.ai/docs/customize/agents-md']),
  blockRule('amp', 'Amp', 'AGENTS.md', ['https://ampcode.com/docs/customize/agents-md']),
  blockRule('zed', 'Zed', 'AGENTS.md', ['https://zed.dev/docs/ai/instructions.md']),
  blockRule('goose', 'Goose', 'AGENTS.md', [
    'https://goose-docs.ai/docs/guides/context-engineering/using-goosehints',
  ]),
  blockRule('factory-droid', 'Factory Droid', 'AGENTS.md', [
    'https://docs.factory.com/harness/agents-md.md',
  ]),
  blockRule('warp', 'Warp', 'AGENTS.md', ['https://docs.warp.dev/agents/capabilities/rules/']),
  blockRule('generic', 'AGENTS.md', 'AGENTS.md', ['https://agents.md/']),
]

export const ruleGaps: KnownGap[] = [
  {
    format: 'rule',
    agent: 'aider',
    reason:
      'Aider reads conventions only from files named in .aider.conf.yml or --read; Sigil does not edit Aider config yet.',
    sources: ['https://aider.chat/docs/usage/conventions.html'],
  },
]
