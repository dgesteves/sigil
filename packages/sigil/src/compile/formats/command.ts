import type { AgentId } from '../../core/ids.js'
import {
  readDocument,
  stringField,
  tomlKey,
  tomlString,
  usesArguments,
  usesGeminiSyntax,
  usesPositional,
  usesShellInjection,
  writeDocument,
} from '../text.js'
import {
  type Adapter,
  type AdapterResult,
  type CapabilityInput,
  type CompileContext,
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
 * A Sigil command is a Claude Code command file: markdown, optional `description` and
 * `argument-hint`, and `$ARGUMENTS` for what the user types. `$ARGUMENTS` is the only placeholder
 * agents agree on; positional numbering differs (Claude Code counts from $0) and shell injection
 * syntax differs, so commands using them are compiled only where the meaning is identical.
 */
interface ParsedCommand {
  description?: string
  argumentHint?: string
  body: string
  dropped: string[]
}

function parseCommand(text: string): ParsedCommand {
  const { data, body } = readDocument(text)
  const description = stringField(data, 'description')
  const argumentHint = stringField(data, 'argument-hint')
  const dropped = Object.keys(data).filter((k) => k !== 'description' && k !== 'argument-hint')
  return {
    ...(description ? { description } : {}),
    ...(argumentHint ? { argumentHint } : {}),
    body,
    dropped,
  }
}

interface Support {
  /** The agent substitutes `$ARGUMENTS` with the typed text. */
  arguments: boolean
  /** The agent runs !`cmd` exactly like Claude Code. */
  shell?: boolean
}

function check(name: string, c: ParsedCommand, s: Support): string | undefined {
  if (usesPositional(c.body))
    return `uses positional placeholders ($0, $1, $ARGUMENTS[N]), which ${name} numbers differently or does not support; use $ARGUMENTS.`
  if (usesShellInjection(c.body) && !s.shell)
    return `runs shell commands with !\`...\`, which ${name} commands do not support.`
  if (usesArguments(c.body) && !s.arguments)
    return `uses $ARGUMENTS, and ${name} documents no placeholder for the text typed after the command.`
  return undefined
}

const droppedNote = (name: string, keys: string[]): Note[] =>
  keys.length
    ? [
        info(
          `${name} ignores ${keys.join(', ')}; ${keys.length === 1 ? 'it was' : 'they were'} left out.`,
        ),
      ]
    : []

type Emit = (c: ParsedCommand, cap: CapabilityInput, ctx: CompileContext) => AdapterResult

function command(
  agent: AgentId,
  name: string,
  target: string,
  sources: string[],
  s: Support,
  emit: Emit,
): Adapter {
  return {
    format: 'command',
    agent,
    target,
    sources,
    compile(cap, ctx) {
      const c = parseCommand(entryText(cap))
      const refused = check(name, c, s)
      return refused ? no(`This command ${refused}`) : emit(c, cap, ctx)
    },
  }
}

const at = (pattern: string, cap: CapabilityInput) => pattern.replace('<slug>', slugOf(cap))

/** Markdown command dirs that take `description` (and optionally `argument-hint`) frontmatter. */
function markdownCommand(
  agent: AgentId,
  name: string,
  target: string,
  sources: string[],
  s: Support & { hint: boolean; extra?: Record<string, unknown>; notes?: Note[] },
): Adapter {
  return command(agent, name, target, sources, s, (c, cap) => {
    const dropped = [...c.dropped, ...(!s.hint && c.argumentHint ? ['argument-hint'] : [])]
    const data = {
      description: c.description,
      ...(s.hint ? { 'argument-hint': c.argumentHint } : {}),
      ...(s.extra ?? {}),
    }
    return ok(
      [fileOp(at(target, cap), writeDocument(data, c.body))],
      [...(s.notes ?? []), ...droppedNote(name, dropped)],
    )
  })
}

/** Gemini CLI style: `{{args}}` replaces $ARGUMENTS; `{{`, `!{` and `@{` in the source would be executed. */
function geminiSafe(name: string, c: ParsedCommand): string | undefined {
  if (usesGeminiSyntax(c.body))
    return `This command contains {{, !{ or @{, which ${name} would interpret as placeholders, shell commands or file injections.`
  return undefined
}

export const commandAdapters: Adapter[] = [
  {
    format: 'command',
    agent: 'claude-code',
    target: '.claude/commands/<slug>.md',
    sources: ['https://code.claude.com/docs/en/skills'],
    compile: (cap) => ok([fileOp(at('.claude/commands/<slug>.md', cap), entryText(cap))]),
  },
  command(
    'cursor',
    'Cursor',
    '.cursor/commands/<slug>.md',
    ['https://cursor.com/changelog/1-6', 'https://cursor.com/docs/reference/deeplinks'],
    { arguments: false },
    (c, cap) =>
      ok(
        [fileOp(at('.cursor/commands/<slug>.md', cap), c.body)],
        [
          ...(c.description || c.argumentHint
            ? [
                info(
                  'Cursor documents commands as plain markdown, so the frontmatter was left out.',
                ),
              ]
            : []),
        ],
      ),
  ),
  markdownCommand(
    'github-copilot',
    'GitHub Copilot',
    '.github/prompts/<slug>.prompt.md',
    ['https://code.visualstudio.com/docs/copilot/customization/prompt-files'],
    {
      arguments: false,
      hint: true,
      notes: [
        warn(
          'Prompt files run only in VS Code Local harness sessions; the Copilot harness, cloud agent and CLI do not load them.',
        ),
      ],
    },
  ),
  command(
    'gemini-cli',
    'Gemini CLI',
    '.gemini/commands/<slug>.toml',
    ['https://geminicli.com/docs/cli/custom-commands/'],
    { arguments: true },
    (c, cap) => {
      const refused = geminiSafe('Gemini CLI', c)
      if (refused) return no(refused)
      const prompt = c.body.replaceAll('$ARGUMENTS', '{{args}}')
      const lines = [
        ...(c.description ? [`${tomlKey('description')} = ${tomlString(c.description)}`] : []),
        `${tomlKey('prompt')} = ${tomlString(prompt)}`,
      ]
      return ok(
        [fileOp(at('.gemini/commands/<slug>.toml', cap), `${lines.join('\n')}\n`)],
        droppedNote('Gemini CLI', [...c.dropped, ...(c.argumentHint ? ['argument-hint'] : [])]),
      )
    },
  ),
  markdownCommand(
    'opencode',
    'OpenCode',
    '.opencode/commands/<slug>.md',
    ['https://opencode.ai/docs/commands/'],
    {
      arguments: true,
      shell: true,
      hint: false,
    },
  ),
  markdownCommand(
    'roo-code',
    'Roo Code',
    '.roo/commands/<slug>.md',
    ['https://roocodeinc.github.io/Roo-Code/features/slash-commands'],
    { arguments: false, hint: true },
  ),
  markdownCommand(
    'kilo-code',
    'Kilo Code',
    '.kilo/commands/<slug>.md',
    ['https://kilo.ai/docs/customize/workflows'],
    {
      arguments: false,
      hint: false,
    },
  ),
  command(
    'junie',
    'Junie',
    '.junie/commands/<slug>.md',
    ['https://junie.jetbrains.com/docs/custom-slash-commands.html'],
    { arguments: false },
    (c, cap) => {
      // Junie treats every $word as a named argument the user must supply.
      if (/\$[A-Za-z_]/.test(c.body))
        return no('This command contains $words, which Junie treats as required named arguments.')
      const dropped = [...c.dropped, ...(c.argumentHint ? ['argument-hint'] : [])]
      return ok(
        [
          fileOp(
            at('.junie/commands/<slug>.md', cap),
            writeDocument({ description: c.description }, c.body),
          ),
        ],
        droppedNote('Junie', dropped),
      )
    },
  ),
  markdownCommand(
    'continue',
    'Continue',
    '.continue/prompts/<slug>.md',
    ['https://docs.continue.dev/customize/deep-dives/prompts'],
    { arguments: false, hint: false, extra: { invokable: true } },
  ),
  markdownCommand(
    'augment',
    'Augment',
    '.augment/commands/<slug>.md',
    ['https://docs.augmentcode.com/cli/custom-commands.md'],
    { arguments: true, hint: true },
  ),
  command(
    'qwen-code',
    'Qwen Code',
    '.qwen/commands/<slug>.md',
    ['https://qwenlm.github.io/qwen-code-docs/en/users/features/commands/'],
    { arguments: true },
    (c, cap) => {
      const refused = geminiSafe('Qwen Code', c)
      if (refused) return no(refused)
      const body = c.body.replaceAll('$ARGUMENTS', '{{args}}')
      const dropped = [...c.dropped, ...(c.argumentHint ? ['argument-hint'] : [])]
      return ok(
        [
          fileOp(
            at('.qwen/commands/<slug>.md', cap),
            writeDocument({ description: c.description }, body),
          ),
        ],
        droppedNote('Qwen Code', dropped),
      )
    },
  ),
  markdownCommand(
    'factory-droid',
    'Factory Droid',
    '.factory/commands/<slug>.md',
    ['https://docs.factory.com/harness/custom-slash-commands.md'],
    { arguments: true, hint: true },
  ),
]

export const commandGaps: KnownGap[] = [
  {
    format: 'command',
    agent: 'codex',
    reason:
      'Codex custom prompts live only in ~/.codex/prompts (user level) and are deprecated in favour of skills; Sigil writes only inside the project.',
    sources: ['https://learn.chatgpt.com/docs/custom-prompts'],
  },
  {
    format: 'command',
    agent: 'windsurf',
    reason:
      'Windsurf workflows ran only in Cascade, which Devin Desktop removed on 2026-09-08; Devin Local does not support them.',
    sources: ['https://docs.devin.ai/desktop/cascade/workflows'],
  },
  {
    format: 'command',
    agent: 'cline',
    reason:
      'Cline documents the workflows directory but not the file format or how arguments are passed.',
    sources: ['https://docs.cline.bot/getting-started/config.md'],
  },
  {
    format: 'command',
    agent: 'amp',
    reason: 'Amp removed custom commands in favour of skills (2026-01-29).',
    sources: ['https://ampcode.com/news/slashing-custom-commands'],
  },
  {
    format: 'command',
    agent: 'aider',
    reason: 'Aider has no user-defined commands.',
    sources: ['https://aider.chat/docs/usage/commands.html'],
  },
  {
    format: 'command',
    agent: 'zed',
    reason: 'Zed exposes skills as slash commands and has no separate command files.',
    sources: ['https://zed.dev/docs/ai/skills.md'],
  },
  {
    format: 'command',
    agent: 'kiro',
    reason: 'Kiro documents the .kiro/prompts directory but not the file format.',
    sources: ['https://kiro.dev/docs/cli/chat/manage-prompts/'],
  },
  {
    format: 'command',
    agent: 'goose',
    reason:
      'Goose slash commands point at recipes from the user config (~/.config/goose/config.yaml); there is no project-level command file.',
    sources: ['https://goose-docs.ai/docs/guides/context-engineering/slash-commands/'],
  },
  {
    format: 'command',
    agent: 'trae',
    reason:
      'Trae documents .trae/commands/ but not the exact frontmatter keys or argument placeholders.',
    sources: ['https://docs.trae.ai/ide/slash-commands'],
  },
  {
    format: 'command',
    agent: 'warp',
    reason: 'Warp has no file-based agent commands; saved prompts live in Warp Drive.',
    sources: ['https://docs.warp.dev/agents/capabilities/slash-commands/'],
  },
  { format: 'command', agent: 'generic', reason: 'There is no cross-agent command file format.' },
]
