import { posix } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { normalize, normalizeShell } from './text.js'
import type { Line } from './types.js'

/**
 * Commands hidden in structure: hook commands, MCP server launch lines and package lifecycle scripts are
 * executed by the agent harness or the package manager, never read by a human in their final form.
 * We lift each one into a virtual script line so every rule sees `npx -y pkg@latest` as one command.
 */
export interface Extracted {
  kind: 'hook' | 'mcp' | 'package-script' | 'helper'
  command: string
  line: number
  /** Script name for package.json, server name for MCP. */
  key?: string
}

export interface StructuredConfig {
  /** Parsed document, or undefined when it does not parse. */
  data: unknown
  extracted: Extracted[]
  /** MCP server URLs (remote transports). */
  urls: { url: string; line: number }[]
  /** Environment variables MCP servers and hooks are given. */
  env: { name: string; line: number }[]
}

const MCP_KEYS = new Set(['mcpServers', 'mcp_servers', 'context_servers', 'mcp'])
const HELPER_KEYS = new Set([
  'apiKeyHelper',
  'awsAuthRefresh',
  'awsCredentialExport',
  'otelHeadersHelper',
])

export function parseConfig(path: string, text: string): StructuredConfig | undefined {
  const base = posix.basename(path)
  let data: unknown
  if (/\.json[c5]?$/i.test(base)) data = parseJsonc(text)
  else if (/\.ya?ml$/i.test(base)) data = safeYaml(text)
  else if (/\.toml$/i.test(base)) return parseTomlServers(text)
  else return undefined
  if (data === undefined) return undefined

  const out: StructuredConfig = { data, extracted: [], urls: [], env: [] }
  const locate = locator(text)
  const isVsCodeMcp = /(?:^|\/)\.vscode\/mcp\.json$/.test(path) || base === 'mcp.json'

  const walk = (v: unknown, keys: string[]): void => {
    if (Array.isArray(v)) {
      for (const x of v) walk(x, keys)
      return
    }
    if (!v || typeof v !== 'object') return
    const o = v as Record<string, unknown>
    const parent = keys.at(-1) ?? ''
    const inMcp = keys.some((k) => MCP_KEYS.has(k)) || (isVsCodeMcp && keys[0] === 'servers')
    const inHooks = keys.includes('hooks')

    if (
      inMcp &&
      (typeof o.command === 'string' || typeof o.url === 'string' || typeof o.httpUrl === 'string')
    ) {
      if (typeof o.command === 'string') {
        const args = Array.isArray(o.args)
          ? o.args.filter((a): a is string => typeof a === 'string')
          : []
        out.extracted.push({
          kind: 'mcp',
          command: [o.command, ...args.map(shellQuote)].join(' '),
          line: locate(o.command),
          key: parent,
        })
      }
      for (const k of ['url', 'httpUrl', 'serverUrl']) {
        const u = o[k]
        if (typeof u === 'string') out.urls.push({ url: u, line: locate(u) })
      }
      if (o.env && typeof o.env === 'object') {
        for (const [name, value] of Object.entries(o.env as Record<string, unknown>)) {
          out.env.push({ name, line: locate(name) })
          if (typeof value === 'string')
            for (const ref of value.matchAll(/\$\{?([A-Z][A-Z0-9_]*)/g))
              out.env.push({ name: ref[1]!, line: locate(name) })
        }
      }
    } else if (
      inHooks &&
      typeof o.command === 'string' &&
      (o.type === undefined || o.type === 'command')
    ) {
      out.extracted.push({ kind: 'hook', command: o.command, line: locate(o.command) })
    }

    for (const [k, x] of Object.entries(o)) {
      if (HELPER_KEYS.has(k) && typeof x === 'string')
        out.extracted.push({ kind: 'helper', command: x, line: locate(x), key: k })
      if (
        k === 'statusLine' &&
        x &&
        typeof x === 'object' &&
        typeof (x as { command?: unknown }).command === 'string'
      ) {
        const cmd = (x as { command: string }).command
        out.extracted.push({ kind: 'helper', command: cmd, line: locate(cmd), key: 'statusLine' })
      }
      if (
        k === 'scripts' &&
        keys.length === 0 &&
        base === 'package.json' &&
        x &&
        typeof x === 'object'
      ) {
        for (const [name, cmd] of Object.entries(x as Record<string, unknown>)) {
          if (typeof cmd === 'string')
            out.extracted.push({
              kind: 'package-script',
              command: cmd,
              line: locate(cmd),
              key: name,
            })
        }
        continue
      }
      walk(x, [...keys, k])
    }
  }
  walk(data, [])
  return out
}

/** Virtual lines for every extracted command, ready for the rule engine. */
export function virtualLines(config: StructuredConfig): Line[] {
  return config.extracted.map((e) => {
    const text = normalizeShell(normalize(e.command))
    return {
      n: e.line,
      raw: e.command,
      text,
      kind: 'script' as const,
      concealed: false,
      shell: true,
      code: true,
      section: e.key ?? '',
      virtual: e.kind,
    }
  })
}

function shellQuote(a: string): string {
  return /^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`
}

/** 1-based line of the first occurrence of a JSON-encoded string, scanning forward from the last hit. */
function locator(text: string): (value: string) => number {
  const lines = text.split('\n')
  return (value: string) => {
    const needle = JSON.stringify(value).slice(1, -1).slice(0, 60)
    const plain = value.slice(0, 60)
    const i = lines.findIndex((l) => l.includes(needle) || l.includes(plain))
    return i >= 0 ? i + 1 : 1
  }
}

/** JSON with comments and trailing commas, as VS Code and Claude Code settings allow. */
export function parseJsonc(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    // fall through to the tolerant path
  }
  let out = ''
  let inString = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    if (inString) {
      out += c
      if (c === '\\') out += text[++i] ?? ''
      else if (c === '"') inString = false
    } else if (c === '"') {
      inString = true
      out += c
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
      out += '\n'
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      const chunk = text.slice(i, end < 0 ? text.length : end + 2)
      out += chunk.replace(/[^\n]/g, ' ')
      i = end < 0 ? text.length : end + 1
    } else out += c
  }
  try {
    return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'))
  } catch {
    return undefined
  }
}

function safeYaml(text: string): unknown {
  try {
    // The yaml package never constructs language objects from tags; unknown tags become plain values.
    return parseYaml(text, { strict: false, uniqueKeys: false, logLevel: 'silent' }) as unknown
  } catch {
    return undefined
  }
}

/** Codex `config.toml`: `[mcp_servers.<name>]` tables with `command`, `args`, `url` and `env`. */
function parseTomlServers(text: string): StructuredConfig {
  const out: StructuredConfig = { data: undefined, extracted: [], urls: [], env: [] }
  const lines = text.split('\n')
  let server: { name: string; command?: string; line: number; args: string[] } | undefined
  let inEnv = false
  const flush = () => {
    if (server?.command)
      out.extracted.push({
        kind: 'mcp',
        command: [server.command, ...server.args.map(shellQuote)].join(' '),
        line: server.line,
        key: server.name,
      })
    server = undefined
  }
  lines.forEach((raw, i) => {
    const table = /^\s*\[([^\]]+)\]\s*$/.exec(raw)?.[1]
    if (table) {
      const m = /^mcp_servers\.("?)([^".]+)\1(\.env)?$/.exec(table.trim())
      if (!m?.[3]) flush()
      inEnv = Boolean(m?.[3])
      if (m && !m[3]) server = { name: m[2]!, line: i + 1, args: [] }
      return
    }
    if (!server) return
    const kv = /^\s*([\w-]+)\s*=\s*(.+?)\s*$/.exec(raw)
    if (!kv) return
    const [, key, value = ''] = kv
    if (inEnv) {
      out.env.push({ name: key!, line: i + 1 })
      return
    }
    if (key === 'command') {
      server.command = tomlString(value)
      server.line = i + 1
    } else if (key === 'args')
      server.args = [...value.matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'/g)].map(
        (m) => m[1] ?? m[2] ?? '',
      )
    else if (key === 'url') out.urls.push({ url: tomlString(value), line: i + 1 })
  })
  flush()
  return out
}

function tomlString(v: string): string {
  const m = /^"((?:[^"\\]|\\.)*)"|^'([^']*)'/.exec(v)
  return m ? (m[1] ?? m[2] ?? '') : v
}
