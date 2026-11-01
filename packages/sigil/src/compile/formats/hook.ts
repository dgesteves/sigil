import { z } from 'zod'
import type { AgentId } from '../../core/ids.js'
import {
  type Adapter,
  type AdapterResult,
  type CapabilityInput,
  entryText,
  type FileOp,
  fileOp,
  type JsonValue,
  type KnownGap,
  type Note,
  no,
  ok,
  slugOf,
  type WriteOp,
  warn,
} from '../types.js'

/* ------------------------------------------------------------------------------------------------
 * Sigil hook payload: `hook.json` plus the scripts it runs.
 *
 * The shape is Claude Code's `hooks` settings object, and scripts speak Claude Code's hook protocol
 * (JSON on stdin, exit code 2 blocks). That protocol is the one other agents document compatibility
 * with, which is what makes a faithful translation possible. Commands may reference payload files
 * only as `./relative/path` tokens; the compiler rewrites them to where the files are installed.
 * ---------------------------------------------------------------------------------------------- */

export const HOOK_EVENTS = [
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'Stop',
  'SubagentStop',
  'PreCompact',
  'Notification',
] as const
export type HookEvent = (typeof HOOK_EVENTS)[number]

const HookHandler = z.strictObject({
  type: z.literal('command'),
  command: z.string().min(1).max(500),
  /** Seconds. */
  timeout: z.number().int().positive().max(600).optional(),
})

const HookGroup = z.strictObject({
  matcher: z.string().max(200).optional(),
  hooks: z.array(HookHandler).min(1),
})

export const HookSpec = z
  .strictObject({ hooks: z.partialRecord(z.enum(HOOK_EVENTS), z.array(HookGroup).min(1)) })
  .refine((h) => Object.keys(h.hooks).length > 0, 'hook.json defines no hooks')
export type HookSpec = z.infer<typeof HookSpec>

const REF = /^\.\/[A-Za-z0-9._/-]+$/

export interface LoadedHooks {
  spec: HookSpec
  /** Payload files the commands reference. */
  refs: Set<string>
  /** Payload files a command runs directly (first token), which need the executable bit. */
  executables: Set<string>
}

export function loadHooks(cap: CapabilityInput): LoadedHooks | string {
  let json: unknown
  try {
    json = JSON.parse(entryText(cap))
  } catch (e) {
    return `${cap.manifest.payload.entry} is not valid JSON: ${(e as Error).message}`
  }
  const parsed = HookSpec.safeParse(json)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!
    return `${cap.manifest.payload.entry}: ${issue.path.join('.') || '(root)'}: ${issue.message}`
  }
  const known = new Set(cap.files.map((f) => f.path))
  const refs = new Set<string>()
  const executables = new Set<string>()
  for (const groups of Object.values(parsed.data.hooks)) {
    for (const g of groups ?? []) {
      for (const h of g.hooks) {
        const tokens = h.command.split(/\s+/).filter(Boolean)
        for (const [i, t] of tokens.entries()) {
          if (!t.startsWith('./')) continue
          const rel = t.slice(2)
          if (!REF.test(t) || rel.split('/').includes('..') || !known.has(rel))
            return `hook command references ${t}, which is not a file in the payload`
          refs.add(rel)
          if (i === 0) executables.add(rel)
        }
      }
    }
  }
  return { spec: parsed.data, refs, executables }
}

export function rewriteCommand(command: string, prefix: (rel: string) => string): string {
  return command
    .split(/(\s+)/)
    .map((t) => (t.startsWith('./') ? prefix(t.slice(2)) : t))
    .join('')
}

/** Claude Code matcher semantics: only letters, digits, `_`, `-`, spaces, `,` and `|` mean exact names. */
export function matcherNames(matcher: string | undefined): 'all' | string[] | 'regex' {
  if (matcher === undefined || matcher === '' || matcher === '*') return 'all'
  if (!/^[A-Za-z0-9_\-, |]+$/.test(matcher)) return 'regex'
  return matcher
    .split(/[|,]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

const TOOL_EVENTS = new Set<HookEvent>(['PreToolUse', 'PostToolUse'])

function scriptOps(cap: CapabilityInput, hooks: LoadedHooks, dir: string): FileOp[] {
  // Ship the whole payload except hook.json, so scripts can import their own helpers.
  return cap.files
    .filter((f) => f.path !== cap.manifest.payload.entry)
    .map((f) =>
      fileOp(`${dir}/${f.path}`, f.content, hooks.executables.has(f.path) ? 0o755 : 0o644),
    )
}

function eventsOf(spec: HookSpec): [HookEvent, NonNullable<HookSpec['hooks'][HookEvent]>][] {
  return HOOK_EVENTS.flatMap((e) => (spec.hooks[e] ? [[e, spec.hooks[e]!] as const] : []))
}

const NOT_EVALUATED = (name: string): Note =>
  warn(
    `${name} runs these hooks through its Claude Code compatibility; check the capability's compatibility results before relying on a blocking hook.`,
  )

/** Claude Code (and Cursor, which runs Claude Code hooks from .claude/settings.json). */
function claudeSettingsOps(cap: CapabilityInput, hooks: LoadedHooks): WriteOp[] {
  const dir = `.claude/hooks/${slugOf(cap)}`
  const ops: WriteOp[] = scriptOps(cap, hooks, dir)
  for (const [event, groups] of eventsOf(hooks.spec)) {
    for (const g of groups) {
      const value: JsonValue = {
        ...(g.matcher !== undefined ? { matcher: g.matcher } : {}),
        hooks: g.hooks.map((h) => ({
          type: 'command',
          command: rewriteCommand(h.command, (rel) => `"\${CLAUDE_PROJECT_DIR}/${dir}/${rel}"`),
          ...(h.timeout ? { timeout: h.timeout } : {}),
        })),
      }
      ops.push({
        kind: 'json',
        path: '.claude/settings.json',
        op: 'append',
        pointer: ['hooks', event],
        value,
      })
    }
  }
  return ops
}

function hookAdapter(
  agent: AgentId,
  target: string,
  sources: string[],
  compile: (cap: CapabilityInput, h: LoadedHooks) => AdapterResult,
): Adapter {
  return {
    format: 'hook',
    agent,
    target,
    sources,
    compile(cap) {
      const h = loadHooks(cap)
      return typeof h === 'string' ? no(h) : compile(cap, h)
    },
  }
}

const CURSOR_EVENTS = new Set<HookEvent>([
  'PreToolUse',
  'PostToolUse',
  'UserPromptSubmit',
  'Stop',
  'SubagentStop',
  'SessionStart',
  'SessionEnd',
  'PreCompact',
])

const COPILOT_EVENTS = new Set<HookEvent>([
  'PreToolUse',
  'PostToolUse',
  'SessionStart',
  'SessionEnd',
  'SubagentStop',
  'PreCompact',
])

const CODEX_EVENTS = new Set<HookEvent>([
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'Stop',
  'SubagentStop',
  'PreCompact',
])

export const hookAdapters: Adapter[] = [
  hookAdapter(
    'claude-code',
    '.claude/settings.json (hooks) + .claude/hooks/<slug>/',
    ['https://code.claude.com/docs/en/hooks'],
    (cap, h) => ok(claudeSettingsOps(cap, h)),
  ),
  hookAdapter(
    'cursor',
    '.claude/settings.json (hooks) + .claude/hooks/<slug>/',
    ['https://cursor.com/docs/reference/third-party-hooks', 'https://cursor.com/docs/hooks'],
    (cap, h) => {
      for (const [event, groups] of eventsOf(h.spec)) {
        if (!CURSOR_EVENTS.has(event)) return no(`Cursor does not run Claude Code ${event} hooks.`)
        for (const g of groups) {
          const names = matcherNames(g.matcher)
          if (Array.isArray(names) && names.includes('Glob'))
            return no('Cursor does not map the Claude Code Glob tool.')
        }
      }
      return ok(claudeSettingsOps(cap, h), [
        warn(
          'Cursor runs Claude Code hooks only while Settings → Agents → Third-Party Imports is on (the default).',
        ),
        NOT_EVALUATED('Cursor'),
      ])
    },
  ),
  hookAdapter(
    'github-copilot',
    '.github/hooks/<slug>.json + .github/hooks/<slug>/',
    ['https://docs.github.com/en/copilot/reference/hooks-reference'],
    (cap, h) => {
      const dir = `.github/hooks/${slugOf(cap)}`
      const hooks: Record<string, JsonValue> = {}
      for (const [event, groups] of eventsOf(h.spec)) {
        if (!COPILOT_EVENTS.has(event))
          return no(`GitHub Copilot does not document a Claude-compatible ${event} event.`)
        // PascalCase event names select Copilot's Claude-compatible payload and matcher semantics.
        hooks[event] = groups.flatMap((g) =>
          g.hooks.map((x) => ({
            type: 'command',
            bash: rewriteCommand(x.command, (rel) => `./${dir}/${rel}`),
            cwd: '.',
            ...(x.timeout ? { timeoutSec: x.timeout } : {}),
            ...(g.matcher !== undefined && g.matcher !== '*' && g.matcher !== ''
              ? { matcher: g.matcher }
              : {}),
          })),
        )
      }
      const config = `${JSON.stringify({ version: 1, hooks }, null, 2)}\n`
      return ok(
        [...scriptOps(cap, h, dir), fileOp(`.github/hooks/${slugOf(cap)}.json`, config)],
        [
          warn(
            'Copilot runs these hooks in the CLI and the cloud agent (VS Code support is in preview); only the bash form is installed, so Windows PowerShell sessions skip them.',
          ),
          NOT_EVALUATED('GitHub Copilot'),
        ],
      )
    },
  ),
  hookAdapter(
    'codex',
    '.codex/hooks.json + .codex/hooks/<slug>/',
    ['https://learn.chatgpt.com/docs/hooks'],
    (cap, h) => {
      const dir = `.codex/hooks/${slugOf(cap)}`
      const ops: WriteOp[] = scriptOps(cap, h, dir)
      for (const [event, groups] of eventsOf(h.spec)) {
        if (!CODEX_EVENTS.has(event)) return no(`Codex has no ${event} hook event.`)
        for (const g of groups) {
          const names = matcherNames(g.matcher)
          let matcher: string | undefined
          if (TOOL_EVENTS.has(event)) {
            // Codex matches its own tool names; only Bash and MCP tools have documented Claude equivalents.
            if (!Array.isArray(names) || !names.every((n) => n === 'Bash' || n.startsWith('mcp__')))
              return no(
                `Codex ${event} hooks are compiled only for Bash and mcp__ tool matchers; this hook matches ${g.matcher ?? 'every tool'}.`,
              )
            matcher = `^(?:${names.join('|')})$`
          } else if (names !== 'all') {
            return no(
              `Codex does not document ${event} matcher values; this hook uses "${g.matcher}".`,
            )
          }
          ops.push({
            kind: 'json',
            path: '.codex/hooks.json',
            op: 'append',
            pointer: ['hooks', event],
            value: {
              ...(matcher ? { matcher } : {}),
              hooks: g.hooks.map((x) => ({
                type: 'command',
                command: rewriteCommand(
                  x.command,
                  (rel) => `"$(git rev-parse --show-toplevel)/${dir}/${rel}"`,
                ),
                ...(x.timeout ? { timeout: x.timeout } : {}),
              })),
            },
          })
        }
      }
      return ok(ops, [
        warn(
          'Codex loads project hooks only for trusted projects, and new hooks stay inactive until you approve them in /hooks.',
        ),
        NOT_EVALUATED('Codex'),
      ])
    },
  ),
]

const DIFFERENT = (name: string, why: string, sources: string[]): KnownGap => ({
  format: 'hook',
  agent: name as AgentId,
  reason: why,
  sources,
})

export const hookGaps: KnownGap[] = [
  DIFFERENT(
    'gemini-cli',
    'Gemini CLI hooks use their own event names (BeforeTool, AfterTool), tool names and stdout contract, so Claude-protocol scripts cannot be translated faithfully.',
    ['https://geminicli.com/docs/hooks/'],
  ),
  DIFFERENT(
    'opencode',
    'OpenCode hooks are JavaScript plugins; generating code would be re-authoring the capability.',
    ['https://opencode.ai/docs/plugins/'],
  ),
  DIFFERENT(
    'windsurf',
    'Cascade hooks (.windsurf/hooks.json) use a different event model, and Devin Local replaced Cascade in Devin Desktop (Cascade stayed available through July 2026).',
    ['https://docs.devin.ai/desktop/cascade/hooks'],
  ),
  DIFFERENT('cline', 'Cline documents its hooks directory but not the hook file format.', [
    'https://docs.cline.bot/customization/hooks.md',
  ]),
  DIFFERENT('roo-code', 'Roo Code has no hooks.', ['https://roocodeinc.github.io/Roo-Code/']),
  DIFFERENT('kilo-code', 'Kilo Code hooks are JavaScript plugins.', [
    'https://kilo.ai/docs/automate/extending/plugins',
  ]),
  DIFFERENT('amp', 'Amp hooks are plugin event handlers in code.', [
    'https://ampcode.com/docs/customize/plugins',
  ]),
  DIFFERENT('aider', 'Aider has no lifecycle hooks (only --lint-cmd and --test-cmd).', [
    'https://aider.chat/docs/usage/lint-test.html',
  ]),
  DIFFERENT('zed', 'Zed does not document hooks.', ['https://zed.dev/docs/ai/overview']),
  DIFFERENT(
    'junie',
    'Junie ignores project-level hooks by default; hooks live in ~/.junie/config.json.',
    ['https://junie.jetbrains.com/docs/junie-cli-hooks.html'],
  ),
  DIFFERENT(
    'kiro',
    'Kiro hooks use their own triggers and tool names, and the working directory of hook commands is not documented.',
    ['https://kiro.dev/docs/hooks/'],
  ),
  DIFFERENT('goose', 'Goose loads hooks only from inside plugins.', [
    'https://goose-docs.ai/docs/guides/context-engineering/hooks/',
  ]),
  DIFFERENT(
    'continue',
    'Continue CLI loads Claude-style hooks but does not fire them yet, and the project has had no release since 2.0.0 (2026-06-19).',
    ['https://github.com/continuedev/continue/pull/13440'],
  ),
  DIFFERENT(
    'augment',
    'Augment hook events and tool names differ (PromptSubmit, bash) and the working directory of hook commands is not documented.',
    ['https://docs.augmentcode.com/cli/hooks.md'],
  ),
  DIFFERENT(
    'qwen-code',
    'Qwen Code hooks match its own tool names (write_file, run_shell_command); Claude Code payload compatibility is not documented.',
    ['https://qwenlm.github.io/qwen-code-docs/en/users/features/hooks/'],
  ),
  DIFFERENT(
    'factory-droid',
    'Factory Droid hooks match its own tool names (Execute); Claude Code payload compatibility is not documented.',
    ['https://docs.factory.com/harness/hooks.md'],
  ),
  DIFFERENT(
    'trae',
    'Trae does not document the working directory of hook commands or its tool names.',
    ['https://docs.trae.ai/ide/hook-configuration-reference'],
  ),
  DIFFERENT('warp', 'Warp has not shipped hooks.', [
    'https://github.com/warpdotdev/warp/issues/7834',
  ]),
  DIFFERENT('generic', 'There is no cross-agent hook format.', []),
]
