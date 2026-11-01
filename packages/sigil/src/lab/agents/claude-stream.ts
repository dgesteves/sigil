import type { AgentEnvironment, AgentOutcome, RawEvent, StampedLine } from './types.js'

/**
 * Parses `claude -p --output-format stream-json --verbose` into lab events.
 *
 * The stream is one JSON object per line: a `system/init` event describing the session (tools,
 * skills, plugins, MCP servers, memory paths, model, version), `assistant` and `user` messages that
 * carry text, tool_use and tool_result blocks, and a final `result` event with usage and cost.
 * Unknown event types are ignored so a newer Claude Code does not break old parsers.
 */

type Json = Record<string, unknown>

const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const strings = (v: unknown): string[] =>
  Array.isArray(v)
    ? v
        .map((x) => (typeof x === 'string' ? x : isObj(x) ? (str(x.name) ?? '') : ''))
        .filter(Boolean)
    : []

/** Bookkeeping events with nothing to show in a replay. */
const QUIET_SYSTEM = new Set(['thinking_tokens', 'status'])
const SYSTEM_TEXT: Record<string, string> = {
  permission_denied: 'a tool call was denied by the permission check',
  compact_boundary: 'the conversation was compacted',
  api_retry: 'the API request was retried',
}

export function parseClaudeStream(lines: readonly StampedLine[], stderr = ''): AgentOutcome {
  const events: RawEvent[] = []
  const toolNames = new Map<string, string>()
  let environment: AgentEnvironment | undefined
  let model: string | undefined
  let version: string | undefined
  let result: Json | undefined
  let lastText = ''

  for (const { t, line } of lines) {
    if (!line.startsWith('{')) continue
    let ev: Json
    try {
      const parsed: unknown = JSON.parse(line)
      if (!isObj(parsed)) continue
      ev = parsed
    } catch {
      continue
    }
    const type = str(ev.type)
    if (type === 'system') {
      if (ev.subtype === 'init') {
        model = str(ev.model)
        version = str(ev.claude_code_version)
        environment = initEnvironment(ev)
        events.push({
          t,
          kind: 'system',
          text: `session started: ${model ?? 'unknown model'}, Claude Code ${version ?? '?'}`,
        })
      } else if (typeof ev.subtype === 'string' && !QUIET_SYSTEM.has(ev.subtype)) {
        events.push({ t, kind: 'system', text: SYSTEM_TEXT[ev.subtype] ?? ev.subtype })
      }
      continue
    }
    if (type === 'result') {
      result = ev
      continue
    }
    if (type !== 'assistant' && type !== 'user') continue
    const message = isObj(ev.message) ? ev.message : undefined
    // Subagent traffic is forwarded with a parent id; it is part of the run and is kept.
    const content = message?.content
    if (typeof content === 'string') {
      if (type === 'assistant') {
        events.push({ t, kind: 'assistant', text: content })
        lastText = content
      }
      continue
    }
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if (!isObj(block)) continue
      if (block.type === 'text' && type === 'assistant') {
        const text = str(block.text) ?? ''
        if (text.trim()) {
          events.push({ t, kind: 'assistant', text })
          lastText = text
        }
      } else if (block.type === 'tool_use') {
        const name = str(block.name) ?? 'tool'
        const input = isObj(block.input) ? block.input : {}
        const id = str(block.id)
        if (id) toolNames.set(id, name)
        events.push({
          t,
          kind: 'tool-call',
          tool: name,
          text: describeToolCall(name, input),
          input,
        })
      } else if (block.type === 'tool_result') {
        const id = str(block.tool_use_id)
        const tool = (id && toolNames.get(id)) || 'tool'
        events.push({
          t,
          kind: 'tool-result',
          tool,
          text: resultText(block.content),
          ok: block.is_error !== true,
        })
      }
    }
  }

  const finalMessage = str(result?.result) ?? lastText
  const usage = isObj(result?.usage) ? result.usage : {}
  const tokens =
    num(usage.input_tokens) +
    num(usage.output_tokens) +
    num(usage.cache_creation_input_tokens) +
    num(usage.cache_read_input_tokens)
  const outcome: AgentOutcome = { events, finalMessage, tokens }
  if (typeof result?.total_cost_usd === 'number') outcome.costUsd = result.total_cost_usd
  if (model) outcome.model = model
  if (version) outcome.version = version
  if (environment) outcome.environment = environment
  const error = agentError(result, stderr)
  if (error) outcome.error = error
  return outcome
}

function initEnvironment(ev: Json): AgentEnvironment {
  const memory = isObj(ev.memory_paths)
    ? Object.values(ev.memory_paths).filter((v): v is string => typeof v === 'string')
    : []
  const plugins = Array.isArray(ev.plugins)
    ? ev.plugins.filter(isObj).map((p) => ({ name: str(p.name) ?? '', path: str(p.path) ?? '' }))
    : []
  const env: AgentEnvironment = {
    tools: strings(ev.tools),
    skills: strings(ev.skills),
    agents: strings(ev.agents),
    plugins,
    mcpServers: strings(ev.mcp_servers),
    memoryPaths: memory,
  }
  const cwd = str(ev.cwd)
  if (cwd) env.cwd = cwd
  return env
}

/**
 * The agent failed on its own terms: auth, API or harness errors. A run like that says nothing about
 * the capability, so the runner records it as an error and does not count it as a task failure.
 */
function agentError(result: Json | undefined, stderr: string): string | undefined {
  if (!result) {
    const last = stderr.trim().split('\n').at(-1)
    return `no result event${last ? `: ${last.slice(0, 300)}` : ''}`
  }
  const terminal = str(result.terminal_reason)
  const isError = result.is_error === true
  if (
    terminal === 'api_error' ||
    (isError && num(result.num_turns) <= 1 && num(result.total_cost_usd) === 0)
  ) {
    return str(result.result) ?? terminal ?? 'agent error'
  }
  return undefined
}

function describeToolCall(name: string, input: Json): string {
  const path = str(input.file_path) ?? str(input.notebook_path) ?? str(input.path)
  switch (name) {
    case 'Bash':
      return `$ ${str(input.command) ?? ''}`
    case 'Read':
      return `Read ${path ?? ''}`
    case 'Write':
      return `Write ${path ?? ''}\n${str(input.content) ?? ''}`
    case 'Edit':
      return `Edit ${path ?? ''}\n- ${str(input.old_string) ?? ''}\n+ ${str(input.new_string) ?? ''}`
    case 'Glob':
    case 'Grep':
      return `${name} ${str(input.pattern) ?? ''}${path ? ` in ${path}` : ''}`
    case 'Skill':
      return `Skill ${str(input.skill) ?? str(input.name) ?? JSON.stringify(input)}`
    default:
      return `${name} ${JSON.stringify(input)}`
  }
}

function resultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((c) => (isObj(c) ? (str(c.text) ?? (c.type === 'image' ? '[image]' : '')) : ''))
    .filter(Boolean)
    .join('\n')
}
