import type { AgentId } from '../../core/ids.js'
import { readDocument, stringField, tomlKey, tomlString, writeDocument } from '../text.js'
import {
  type Adapter,
  type CapabilityInput,
  entryText,
  fileOp,
  info,
  type KnownGap,
  type Note,
  no,
  ok,
  slugOf,
  warn,
} from '../types.js'

/**
 * A Sigil subagent is a Claude Code subagent file. `name`, `description` and the prompt body are
 * portable. A `tools` list is a security boundary: an agent that cannot express the same
 * restriction would give the subagent every tool, so such targets are refused, never widened.
 */
interface ParsedAgent {
  name: string
  description: string
  tools?: string[]
  body: string
  /** Frontmatter keys other agents do not understand (model ids, permission modes, hooks...). */
  extra: string[]
}

function parseAgent(cap: CapabilityInput): ParsedAgent | string {
  const { data, body } = readDocument(entryText(cap))
  const name = stringField(data, 'name') ?? slugOf(cap)
  const description = stringField(data, 'description')
  if (!description)
    return 'The subagent has no description, which every agent needs to decide when to delegate.'
  if (!body.trim()) return 'The subagent has an empty prompt body.'
  const raw = data.tools
  const tools =
    typeof raw === 'string'
      ? raw
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
      : Array.isArray(raw)
        ? raw.filter((t): t is string => typeof t === 'string')
        : undefined
  const extra = Object.keys(data).filter((k) => !['name', 'description', 'tools'].includes(k))
  return { name, description, ...(tools ? { tools } : {}), body, extra }
}

const restricted = (agentName: string) =>
  `The subagent restricts its tools, and ${agentName} cannot express that restriction; installing it would grant every tool.`

const extraNote = (agentName: string, keys: string[]): Note[] =>
  keys.length
    ? [
        info(
          `${agentName} does not understand ${keys.join(', ')}; left out, so the agent's defaults apply.`,
        ),
      ]
    : []

interface MarkdownTarget {
  agent: AgentId
  name: string
  target: string
  sources: string[]
  /** Frontmatter for the target. Return a string to refuse. */
  fields: (a: ParsedAgent, cap: CapabilityInput) => Record<string, unknown>
  notes?: Note[]
}

function markdownAgent(t: MarkdownTarget): Adapter {
  return {
    format: 'subagent',
    agent: t.agent,
    target: t.target,
    sources: t.sources,
    compile(cap) {
      const a = parseAgent(cap)
      if (typeof a === 'string') return no(a)
      if (a.tools) return no(restricted(t.name))
      const content = writeDocument(t.fields(a, cap), a.body)
      return ok(
        [fileOp(t.target.replace('<slug>', slugOf(cap)), content)],
        [...(t.notes ?? []), ...extraNote(t.name, a.extra)],
      )
    },
  }
}

/** Claude tool names GitHub Copilot accepts as aliases (custom-agents-configuration, tool aliases). */
const COPILOT_ALIASES = new Set([
  'Bash',
  'Read',
  'NotebookRead',
  'Edit',
  'MultiEdit',
  'Write',
  'NotebookEdit',
  'Grep',
  'Glob',
  'Task',
  'WebSearch',
  'WebFetch',
  'TodoWrite',
])

export const subagentAdapters: Adapter[] = [
  {
    format: 'subagent',
    agent: 'claude-code',
    target: '.claude/agents/<slug>.md',
    sources: ['https://code.claude.com/docs/en/sub-agents'],
    compile(cap) {
      const a = parseAgent(cap)
      if (typeof a === 'string') return no(a)
      const notes = a.tools
        ? [
            warn(
              'Cursor and Goose also load .claude/agents/ and do not document a tools field there; they may give this subagent every tool.',
            ),
          ]
        : []
      return ok([fileOp(`.claude/agents/${slugOf(cap)}.md`, entryText(cap))], notes)
    },
  },
  {
    format: 'subagent',
    agent: 'github-copilot',
    target: '.github/agents/<slug>.agent.md',
    sources: ['https://docs.github.com/en/copilot/reference/custom-agents-configuration'],
    compile(cap) {
      const a = parseAgent(cap)
      if (typeof a === 'string') return no(a)
      const unknown = a.tools?.filter((t) => !COPILOT_ALIASES.has(t)) ?? []
      // Copilot ignores unknown tool names, which narrows the list: safe, but worth saying.
      const notes = [
        ...(unknown.length
          ? [
              warn(
                `GitHub Copilot ignores the tools ${unknown.join(', ')}, so the subagent runs without them.`,
              ),
            ]
          : []),
        ...extraNote('GitHub Copilot', a.extra),
      ]
      const data = {
        name: a.name,
        description: a.description,
        ...(a.tools ? { tools: a.tools } : {}),
      }
      return ok(
        [fileOp(`.github/agents/${slugOf(cap)}.agent.md`, writeDocument(data, a.body))],
        notes,
      )
    },
  },
  {
    format: 'subagent',
    agent: 'codex',
    target: '.codex/agents/<slug>.toml',
    sources: ['https://learn.chatgpt.com/docs/agent-configuration/subagents'],
    compile(cap) {
      const a = parseAgent(cap)
      if (typeof a === 'string') return no(a)
      if (a.tools) return no(restricted('Codex'))
      const toml = [
        `${tomlKey('name')} = ${tomlString(a.name)}`,
        `${tomlKey('description')} = ${tomlString(a.description)}`,
        `${tomlKey('developer_instructions')} = ${tomlString(a.body.trim())}`,
      ].join('\n')
      return ok(
        [fileOp(`.codex/agents/${slugOf(cap)}.toml`, `${toml}\n`)],
        [
          warn('Codex loads project .codex/ layers only for trusted projects.'),
          ...extraNote('Codex', a.extra),
        ],
      )
    },
  },
  markdownAgent({
    agent: 'cursor',
    name: 'Cursor',
    target: '.cursor/agents/<slug>.md',
    sources: ['https://cursor.com/docs/subagents'],
    fields: (a) => ({ name: a.name, description: a.description }),
  }),
  markdownAgent({
    agent: 'gemini-cli',
    name: 'Gemini CLI',
    target: '.gemini/agents/<slug>.md',
    sources: ['https://geminicli.com/docs/core/subagents/'],
    fields: (a) => ({ name: a.name, description: a.description }),
  }),
  markdownAgent({
    agent: 'opencode',
    name: 'OpenCode',
    target: '.opencode/agents/<slug>.md',
    sources: ['https://opencode.ai/docs/agents/'],
    fields: (a) => ({ description: a.description, mode: 'subagent' }),
  }),
  markdownAgent({
    agent: 'kilo-code',
    name: 'Kilo Code',
    target: '.kilo/agents/<slug>.md',
    sources: ['https://kilo.ai/docs/customize/custom-subagents'],
    fields: (a) => ({ description: a.description, mode: 'subagent' }),
  }),
  markdownAgent({
    agent: 'junie',
    name: 'Junie',
    target: '.junie/agents/<slug>.md',
    sources: ['https://junie.jetbrains.com/docs/junie-cli-subagents.html'],
    fields: (a) => ({ name: a.name, description: a.description }),
    notes: [info('Junie documents subagents for the Junie CLI.')],
  }),
  markdownAgent({
    agent: 'kiro',
    name: 'Kiro',
    target: '.kiro/agents/<slug>.md',
    sources: ['https://kiro.dev/docs/custom-agents/creating/'],
    fields: (a) => ({ name: a.name, description: a.description }),
    notes: [warn('Kiro loads workspace agents only from trusted workspaces.')],
  }),
  markdownAgent({
    agent: 'goose',
    name: 'Goose',
    target: '.agents/agents/<slug>.md',
    sources: ['https://goose-docs.ai/docs/guides/context-engineering/custom-agents/'],
    fields: (a) => ({ name: a.name, description: a.description }),
  }),
  markdownAgent({
    agent: 'augment',
    name: 'Augment',
    target: '.augment/agents/<slug>.md',
    sources: ['https://docs.augmentcode.com/cli/subagents.md'],
    fields: (a) => ({ name: a.name, description: a.description }),
  }),
  markdownAgent({
    agent: 'qwen-code',
    name: 'Qwen Code',
    target: '.qwen/agents/<slug>.md',
    sources: ['https://qwenlm.github.io/qwen-code-docs/en/users/features/sub-agents/'],
    fields: (a) => ({ name: a.name, description: a.description }),
  }),
  markdownAgent({
    agent: 'factory-droid',
    name: 'Factory Droid',
    target: '.factory/droids/<slug>.md',
    sources: ['https://docs.factory.com/harness/subagents.md'],
    fields: (a) => ({ name: a.name, description: a.description, model: 'inherit' }),
  }),
  markdownAgent({
    agent: 'trae',
    name: 'Trae',
    target: '.trae/agents/<slug>.md',
    sources: ['https://docs.trae.ai/ide/subagents?_lang=en'],
    fields: (a) => ({ name: a.name, description: a.description }),
    notes: [
      warn('Trae reads .trae/agents/ only when "Enable Subagents Directory" is switched on.'),
    ],
  }),
]

export const subagentGaps: KnownGap[] = [
  {
    format: 'subagent',
    agent: 'windsurf',
    reason:
      'Cascade had no file-defined subagents; Devin Desktop uses its own .devin/agents format, which Sigil does not target yet.',
    sources: ['https://docs.devin.ai/desktop/changelog'],
  },
  {
    format: 'subagent',
    agent: 'cline',
    reason: 'Cline documents the .cline/agents directory but not its file format.',
    sources: ['https://docs.cline.bot/features/subagents.md'],
  },
  {
    format: 'subagent',
    agent: 'roo-code',
    reason: 'Roo Code has custom modes (.roomodes), a different concept with a different shape.',
    sources: ['https://roocodeinc.github.io/Roo-Code/features/custom-modes'],
  },
  {
    format: 'subagent',
    agent: 'amp',
    reason: 'Amp defines subagents only in plugin code.',
    sources: ['https://ampcode.com/docs/models-and-subagents'],
  },
  { format: 'subagent', agent: 'aider', reason: 'Aider has no subagents.' },
  {
    format: 'subagent',
    agent: 'zed',
    reason: 'Zed has agent profiles in settings but no file format for custom subagents.',
    sources: ['https://zed.dev/docs/ai/agent-profiles.md'],
  },
  {
    format: 'subagent',
    agent: 'continue',
    reason: 'Continue does not document local agent files.',
    sources: ['https://docs.continue.dev/reference'],
  },
  {
    format: 'subagent',
    agent: 'warp',
    reason: 'Warp agent profiles live in app settings, not in project files.',
    sources: ['https://docs.warp.dev/agents/capabilities/agent-profiles-permissions/'],
  },
  { format: 'subagent', agent: 'generic', reason: 'There is no cross-agent subagent file format.' },
]
