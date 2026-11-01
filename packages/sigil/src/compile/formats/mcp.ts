import { z } from 'zod'
import type { AgentId } from '../../core/ids.js'
import { tomlArray, tomlBasic, tomlKey } from '../text.js'
import {
  type Adapter,
  type CapabilityInput,
  entryText,
  fileOp,
  info,
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
 * server.json, the official MCP registry format (schema 2025-12-11). Only the fields Sigil needs
 * are modelled; everything else passes through untouched.
 * ---------------------------------------------------------------------------------------------- */

const Input = z.looseObject({
  name: z.string().min(1),
  description: z.string().optional(),
  isRequired: z.boolean().optional(),
  isSecret: z.boolean().optional(),
  default: z.string().optional(),
  value: z.string().optional(),
})

const Argument = z.looseObject({
  type: z.enum(['positional', 'named']),
  name: z.string().optional(),
  value: z.string().optional(),
  valueHint: z.string().optional(),
  isRequired: z.boolean().optional(),
})

const Package = z.looseObject({
  registryType: z.string().min(1),
  registryBaseUrl: z.string().optional(),
  identifier: z.string().min(1),
  version: z.string().optional(),
  transport: z.looseObject({ type: z.enum(['stdio', 'streamable-http', 'sse']) }),
  runtimeArguments: z.array(Argument).optional(),
  packageArguments: z.array(Argument).optional(),
  environmentVariables: z.array(Input).optional(),
})

const Remote = z.looseObject({
  type: z.enum(['streamable-http', 'sse']),
  url: z.string().min(1),
  headers: z.array(Input).optional(),
})

export const ServerJson = z.looseObject({
  name: z.string().min(3).max(200),
  description: z.string().min(1),
  version: z.string().min(1),
  packages: z.array(Package).optional(),
  remotes: z.array(Remote).optional(),
})
export type ServerJson = z.infer<typeof ServerJson>

/** What every agent's config is generated from. Secret values never appear: only variable names. */
export type ServerSpec =
  | {
      transport: 'stdio'
      command: string
      args: string[]
      /** Variables the server needs from the user's environment. */
      env: string[]
      /** Human description of what starts, for the install preview. */
      runs: string
    }
  | { transport: 'http' | 'sse'; url: string; runs: string }

const DEFAULT_REGISTRY: Record<string, string> = {
  npm: 'https://registry.npmjs.org',
  pypi: 'https://pypi.org',
}

function packageArgs(pkg: z.infer<typeof Package>): string[] | string {
  const out: string[] = []
  for (const a of pkg.packageArguments ?? []) {
    if (a.value === undefined || a.value.includes('{'))
      return `package argument ${a.name ?? a.valueHint ?? '(positional)'} needs a value from the user`
    if (a.type === 'named') out.push(a.name ?? '', a.value)
    else out.push(a.value)
  }
  return out.filter(Boolean)
}

export function toServerSpec(server: ServerJson): ServerSpec | string {
  for (const pkg of server.packages ?? []) {
    if (pkg.transport.type !== 'stdio') continue
    if (pkg.runtimeArguments?.length)
      return 'the package declares runtimeArguments, which Sigil does not translate yet'
    const base = DEFAULT_REGISTRY[pkg.registryType]
    if (pkg.registryBaseUrl && base && pkg.registryBaseUrl.replace(/\/$/, '') !== base)
      return `the package comes from ${pkg.registryBaseUrl}, not the default ${pkg.registryType} registry`
    const args = packageArgs(pkg)
    if (typeof args === 'string') return args
    const env = (pkg.environmentVariables ?? []).filter((v) => v.isRequired).map((v) => v.name)
    if (!env.every((n) => /^[A-Z_][A-Z0-9_]*$/.test(n)))
      return 'an environment variable name is not portable (A-Z, 0-9, _)'
    if (pkg.registryType === 'npm' || pkg.registryType === 'pypi') {
      if (!pkg.version || pkg.version === 'latest') return 'the package version is not pinned'
      const npm = pkg.registryType === 'npm'
      const spec = npm ? `${pkg.identifier}@${pkg.version}` : `${pkg.identifier}==${pkg.version}`
      return {
        transport: 'stdio',
        command: npm ? 'npx' : 'uvx',
        args: [...(npm ? ['-y'] : []), spec, ...args],
        env,
        runs: `${pkg.registryType} package ${spec}`,
      }
    }
    if (pkg.registryType === 'oci') {
      return {
        transport: 'stdio',
        command: 'docker',
        args: ['run', '-i', '--rm', ...env.flatMap((n) => ['-e', n]), pkg.identifier, ...args],
        env,
        runs: `container image ${pkg.identifier}`,
      }
    }
  }
  const remote = server.remotes?.[0]
  if (remote) {
    if (!/^https:\/\//.test(remote.url) || remote.url.includes('{'))
      return 'the remote URL is not a fixed https URL'
    const required = (remote.headers ?? []).filter((h) => h.isRequired)
    if (required.length)
      return `the remote server needs ${required.map((h) => h.name).join(', ')} headers, which Sigil cannot fill without a secret`
    return {
      transport: remote.type === 'sse' ? 'sse' : 'http',
      url: remote.url,
      runs: `remote server ${remote.url}`,
    }
  }
  return 'server.json has no stdio package (npm, pypi or oci) and no remote Sigil can install'
}

export function loadServer(cap: CapabilityInput): ServerSpec | string {
  let json: unknown
  try {
    json = JSON.parse(entryText(cap))
  } catch (e) {
    return `${cap.manifest.payload.entry} is not valid JSON: ${(e as Error).message}`
  }
  const parsed = ServerJson.safeParse(json)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!
    return `${cap.manifest.payload.entry}: ${issue.path.join('.') || '(root)'}: ${issue.message}`
  }
  return toServerSpec(parsed.data)
}

/* ------------------------------------------------------------------------------------------------
 * Per-agent writers.
 * ---------------------------------------------------------------------------------------------- */

interface JsonTarget {
  agent: AgentId
  name: string
  file: string
  /** Key path of the server map inside the file. */
  root: string[]
  sources: string[]
  /** How the agent references an environment variable inside the config, or null if it cannot. */
  envRef: ((name: string) => string) | null
  entry: (s: ServerSpec, env: Record<string, string>) => JsonValue | string
  notes?: Note[]
  reserved?: string[]
}

const runsNote = (s: ServerSpec): Note =>
  s.transport === 'stdio'
    ? info(
        `The agent starts ${s.runs} when it launches; that code is downloaded then and is not part of the sealed payload.`,
      )
    : info(`The agent connects to ${s.runs}; its behaviour is not part of the sealed payload.`)

const envNote = (s: ServerSpec): Note[] =>
  s.transport === 'stdio' && s.env.length
    ? [warn(`Set ${s.env.join(', ')} in your environment before starting the agent.`)]
    : []

function jsonMcp(t: JsonTarget): Adapter {
  return {
    format: 'mcp-server',
    agent: t.agent,
    target: `${t.file} (${t.root.join('.')}.<slug>)`,
    sources: t.sources,
    compile(cap) {
      const s = loadServer(cap)
      if (typeof s === 'string') return no(`Cannot install this server: ${s}.`)
      const key = slugOf(cap)
      if (t.reserved?.includes(key)) return no(`"${key}" is a reserved key in ${t.file}.`)
      const env: Record<string, string> = {}
      if (s.transport === 'stdio' && s.env.length) {
        if (!t.envRef)
          return no(
            `${t.name} does not document environment variable references in MCP config, and this server needs ${s.env.join(', ')}.`,
          )
        for (const n of s.env) env[n] = t.envRef(n)
      }
      const value = t.entry(s, env)
      if (typeof value === 'string') return no(value)
      // A `<slug>` in the path means one file per server (Continue), so the file is owned outright.
      const op: WriteOp = t.file.includes('<slug>')
        ? fileOp(
            t.file.replace('<slug>', key),
            `${JSON.stringify({ [t.root[0]!]: { [key]: value } }, null, 2)}\n`,
          )
        : { kind: 'json', path: t.file, op: 'set', pointer: [...t.root, key], value }
      return ok([op], [runsNote(s), ...envNote(s), ...(t.notes ?? [])])
    },
  }
}

type JsonObject = { [key: string]: JsonValue }

/** Builds a JSON object, leaving out undefined fields and empty maps. */
function obj(fields: Record<string, JsonValue | undefined>): JsonObject {
  const out: JsonObject = {}
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue
    if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) continue
    out[k] = v
  }
  return out
}

/** `{command, args, env}` / `{url}`: the shape most agents copied from Claude Desktop. */
const plain =
  (remoteType?: (t: 'http' | 'sse') => string | undefined) =>
  (s: ServerSpec, env: Record<string, string>): JsonValue => {
    if (s.transport === 'stdio') return obj({ command: s.command, args: s.args, env })
    return obj({ type: remoteType?.(s.transport), url: s.url })
  }

const dollarBrace = (n: string) => `\${${n}}`

const OPENCODE_SHAPE = (s: ServerSpec, env: Record<string, string>): JsonValue =>
  s.transport === 'stdio'
    ? obj({ type: 'local', command: [s.command, ...s.args], environment: env, enabled: true })
    : s.transport === 'sse'
      ? 'OpenCode remote servers are documented for streamable HTTP only; this server uses SSE.'
      : { type: 'remote', url: s.url, enabled: true }

const GEMINI_SHAPE = (s: ServerSpec, env: Record<string, string>): JsonValue =>
  s.transport === 'stdio'
    ? obj({ command: s.command, args: s.args, env })
    : s.transport === 'sse'
      ? { url: s.url }
      : { httpUrl: s.url }

const JSON_TARGETS: JsonTarget[] = [
  {
    agent: 'claude-code',
    name: 'Claude Code',
    file: '.mcp.json',
    root: ['mcpServers'],
    sources: ['https://code.claude.com/docs/en/mcp'],
    envRef: dollarBrace,
    entry: plain((t) => t),
    notes: [info('Claude Code asks each user to approve project servers from .mcp.json.')],
  },
  {
    agent: 'cursor',
    name: 'Cursor',
    file: '.cursor/mcp.json',
    root: ['mcpServers'],
    sources: ['https://cursor.com/docs/mcp'],
    envRef: (n) => `\${env:${n}}`,
    entry: plain(),
  },
  {
    agent: 'gemini-cli',
    name: 'Gemini CLI',
    file: '.gemini/settings.json',
    root: ['mcpServers'],
    sources: ['https://geminicli.com/docs/tools/mcp-server/'],
    envRef: dollarBrace,
    entry: GEMINI_SHAPE,
  },
  {
    agent: 'qwen-code',
    name: 'Qwen Code',
    file: '.qwen/settings.json',
    root: ['mcpServers'],
    sources: ['https://qwenlm.github.io/qwen-code-docs/en/users/features/mcp/'],
    envRef: dollarBrace,
    entry: GEMINI_SHAPE,
    notes: [warn('Qwen Code asks you to approve workspace MCP servers before it connects.')],
  },
  {
    agent: 'opencode',
    name: 'OpenCode',
    file: 'opencode.json',
    root: ['mcp'],
    sources: ['https://opencode.ai/docs/mcp-servers/'],
    envRef: (n) => `{env:${n}}`,
    entry: OPENCODE_SHAPE,
    reserved: ['servers', 'timeout'],
  },
  {
    agent: 'kilo-code',
    name: 'Kilo Code',
    file: 'kilo.json',
    root: ['mcp'],
    sources: ['https://kilo.ai/docs/automate/mcp/using-in-cli'],
    envRef: (n) => `{env:${n}}`,
    entry: OPENCODE_SHAPE,
  },
  {
    agent: 'roo-code',
    name: 'Roo Code',
    file: '.roo/mcp.json',
    root: ['mcpServers'],
    sources: ['https://roocodeinc.github.io/Roo-Code/features/mcp/using-mcp-in-roo'],
    envRef: (n) => `\${env:${n}}`,
    entry: plain((t) => (t === 'http' ? 'streamable-http' : 'sse')),
  },
  {
    agent: 'amp',
    name: 'Amp',
    file: '.amp/settings.json',
    root: ['amp.mcpServers'],
    sources: ['https://ampcode.com/docs/customize/mcp'],
    envRef: dollarBrace,
    entry: (s, env) =>
      s.transport === 'sse' ? 'Amp does not document SSE servers.' : plain()(s, env),
    notes: [warn('Amp starts project servers only after you run amp mcp approve <name>.')],
  },
  {
    agent: 'zed',
    name: 'Zed',
    file: '.zed/settings.json',
    root: ['context_servers'],
    sources: ['https://zed.dev/docs/ai/mcp.md'],
    envRef: null,
    entry: (s, env) =>
      s.transport === 'sse' ? 'Zed does not document SSE servers.' : plain()(s, env),
    notes: [warn('Zed starts project MCP servers only in trusted worktrees.')],
  },
  {
    agent: 'junie',
    name: 'Junie',
    file: '.junie/mcp/mcp.json',
    root: ['mcpServers'],
    sources: ['https://junie.jetbrains.com/docs/junie-cli-mcp-configuration.html'],
    envRef: null,
    entry: plain(),
  },
  {
    agent: 'kiro',
    name: 'Kiro',
    file: '.kiro/settings/mcp.json',
    root: ['mcpServers'],
    sources: ['https://kiro.dev/docs/mcp/configuration/'],
    envRef: dollarBrace,
    entry: plain(),
    notes: [
      warn(
        'Kiro expands only environment variables listed in its "Mcp Approved Env Vars" setting.',
      ),
    ],
  },
  {
    agent: 'augment',
    name: 'Augment',
    file: '.augment/settings.json',
    root: ['mcpServers'],
    sources: ['https://docs.augmentcode.com/cli/integrations.md'],
    envRef: dollarBrace,
    entry: plain((t) => t),
  },
  {
    agent: 'factory-droid',
    name: 'Factory Droid',
    file: '.factory/mcp.json',
    root: ['mcpServers'],
    sources: ['https://docs.factory.com/harness/mcp.md'],
    envRef: dollarBrace,
    entry: (s, env) =>
      s.transport === 'stdio'
        ? obj({ type: 'stdio', command: s.command, args: s.args, env })
        : { type: s.transport, url: s.url },
  },
  {
    agent: 'warp',
    name: 'Warp',
    file: '.warp/.mcp.json',
    root: ['mcpServers'],
    sources: ['https://docs.warp.dev/agents/capabilities/mcp/'],
    envRef: null,
    entry: plain(),
    notes: [warn('Warp asks for approval before it starts project-scoped servers.')],
  },
  {
    agent: 'trae',
    name: 'Trae',
    file: '.trae/mcp.json',
    root: ['mcpServers'],
    sources: ['https://docs.trae.ai/ide/add-mcp-servers'],
    envRef: null,
    entry: plain(),
    notes: [warn('Trae reads .trae/mcp.json only when "Enable Project MCP" is switched on.')],
  },
  {
    agent: 'continue',
    name: 'Continue',
    file: '.continue/mcpServers/<slug>.json',
    root: ['mcpServers'],
    sources: ['https://docs.continue.dev/customize/deep-dives/mcp'],
    envRef: null,
    entry: plain(),
    notes: [info('Continue uses MCP servers only in agent mode, in the IDE extensions.')],
  },
]

/** GitHub Copilot: VS Code reads .vscode/mcp.json, Copilot CLI reads .github/mcp.json. */
const copilot: Adapter = {
  format: 'mcp-server',
  agent: 'github-copilot',
  target: '.vscode/mcp.json (servers.<slug>) + .github/mcp.json (mcpServers.<slug>)',
  sources: [
    'https://code.visualstudio.com/docs/copilot/reference/mcp-configuration',
    'https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers',
  ],
  compile(cap) {
    const s = loadServer(cap)
    if (typeof s === 'string') return no(`Cannot install this server: ${s}.`)
    const key = slugOf(cap)
    const env = (fmt: (n: string) => string): JsonObject =>
      s.transport === 'stdio' ? Object.fromEntries(s.env.map((n) => [n, fmt(n)])) : {}
    const vscode =
      s.transport === 'stdio'
        ? obj({ type: 'stdio', command: s.command, args: s.args, env: env((n) => `\${env:${n}}`) })
        : obj({ type: s.transport, url: s.url })
    const cli =
      s.transport === 'stdio'
        ? obj({
            type: 'local',
            command: s.command,
            args: s.args,
            env: env(dollarBrace),
            tools: ['*'],
          })
        : obj({ type: s.transport, url: s.url, tools: ['*'] })
    return ok(
      [
        {
          kind: 'json',
          path: '.vscode/mcp.json',
          op: 'set',
          pointer: ['servers', key],
          value: vscode,
        },
        {
          kind: 'json',
          path: '.github/mcp.json',
          op: 'set',
          pointer: ['mcpServers', key],
          value: cli,
        },
      ],
      [
        runsNote(s),
        ...envNote(s),
        warn(
          'The Copilot cloud agent reads MCP servers only from repository settings on github.com; add it there by hand.',
        ),
        info('Copilot CLI loads project servers only after you trust the folder.'),
      ],
    )
  },
}

/** Codex: a `[mcp_servers.<slug>]` table appended to .codex/config.toml in a marked block. */
const codex: Adapter = {
  format: 'mcp-server',
  agent: 'codex',
  target: '.codex/config.toml ([mcp_servers.<slug>])',
  sources: [
    'https://learn.chatgpt.com/docs/extend/mcp?surface=cli',
    'https://learn.chatgpt.com/docs/config-file/config-reference',
  ],
  compile(cap, ctx) {
    const s = loadServer(cap)
    if (typeof s === 'string') return no(`Cannot install this server: ${s}.`)
    if (s.transport === 'sse')
      return no('Codex documents streamable HTTP servers only; this server uses SSE.')
    const key = slugOf(cap)
    const lines = [`[mcp_servers.${tomlKey(key)}]`]
    if (s.transport === 'stdio') {
      lines.push(`command = ${tomlBasic(s.command)}`, `args = ${tomlArray(s.args)}`)
      if (s.env.length) lines.push(`env_vars = ${tomlArray(s.env)}`)
    } else {
      lines.push(`url = ${tomlBasic(s.url)}`)
    }
    const notes = [
      runsNote(s),
      ...envNote(s),
      warn('Codex loads project config only for trusted projects.'),
    ]
    if (ctx.exists('.codex/config.toml'))
      notes.push(info('The table is appended to your existing .codex/config.toml.'))
    return ok(
      [
        {
          kind: 'block',
          path: '.codex/config.toml',
          syntax: 'toml',
          id: cap.manifest.id,
          content: lines.join('\n'),
        },
      ],
      notes,
    )
  },
}

export const mcpAdapters: Adapter[] = [...JSON_TARGETS.map(jsonMcp), copilot, codex]

export const mcpGaps: KnownGap[] = [
  {
    format: 'mcp-server',
    agent: 'windsurf',
    reason:
      'Windsurf reads MCP servers only from ~/.codeium/windsurf/mcp_config.json (user level); Sigil writes only inside the project.',
    sources: ['https://docs.windsurf.com/pt-BR/windsurf/cascade/mcp.md'],
  },
  {
    format: 'mcp-server',
    agent: 'cline',
    reason:
      'Cline reads MCP servers only from its user-level settings file; there is no project file.',
    sources: ['https://docs.cline.bot/mcp/mcp-overview.md'],
  },
  {
    format: 'mcp-server',
    agent: 'aider',
    reason: 'Aider does not support MCP.',
    sources: ['https://aider.chat/docs/config/options.html'],
  },
  {
    format: 'mcp-server',
    agent: 'goose',
    reason:
      'Goose reads extensions from ~/.config/goose/config.yaml; a project-level file is not documented.',
    sources: ['https://goose-docs.ai/docs/guides/config-files/'],
  },
  { format: 'mcp-server', agent: 'generic', reason: 'There is no cross-agent MCP config file.' },
]
