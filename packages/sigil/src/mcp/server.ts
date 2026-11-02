import { createInterface } from 'node:readline'
import type { Readable, Writable } from 'node:stream'
import { z } from 'zod'
import { SourceError } from '../compile/source.js'
import { type Catalog, CatalogError } from './catalog.js'
import { inputSchema, TOOLS, type Tool } from './tools.js'

/** Newest first. A client asking for one of these gets it back; anything else gets the newest. */
export const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']

const INSTRUCTIONS = `Sigil is the open proving ground for AI agent capabilities: it A/B-tests skills, rules, subagents, hooks and MCP servers against hidden tests, scans them, and seals the exact content it tested.
- Call recommend when you start in a project to see capabilities for its stack; call search to find one for a task.
- Call get before suggesting a capability and cite its evidence. Only uplift "proven" means agents measurably did better with it; "untested" and "inconclusive" are not endorsements.
- This server never writes files. To install, call plan_install, show the user the plan, and let them run the command it returns.`

export interface ServeOptions {
  catalog: Catalog
  version: string
  /** Diagnostics go to stderr; stdout carries protocol messages only. */
  log: (line: string) => void
  tools?: Tool[]
}

type Id = string | number
interface Message {
  jsonrpc?: unknown
  id?: unknown
  method?: unknown
  params?: unknown
}

class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message)
  }
}

/** Serves MCP over newline-delimited JSON-RPC until the input ends. */
export async function serve(input: Readable, output: Writable, opts: ServeOptions): Promise<void> {
  const tools = opts.tools ?? TOOLS
  const send = (msg: Record<string, unknown>): void => {
    output.write(`${JSON.stringify({ jsonrpc: '2.0', ...msg })}\n`)
  }
  const pending = new Set<Promise<void>>()

  const handle = async (method: string, params: Record<string, unknown>) => {
    switch (method) {
      case 'initialize': {
        const asked = typeof params.protocolVersion === 'string' ? params.protocolVersion : ''
        return {
          protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'sigil', title: 'Sigil', version: opts.version },
          instructions: INSTRUCTIONS,
        }
      }
      case 'ping':
        return {}
      case 'tools/list':
        return {
          tools: tools.map((t) => ({
            name: t.name,
            title: t.title,
            description: t.description,
            inputSchema: inputSchema(t),
            annotations: {
              title: t.title,
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: true,
            },
          })),
        }
      case 'tools/call':
        return call(tools, opts, params)
      default:
        throw new RpcError(-32601, `method not found: ${method}`)
    }
  }

  const onLine = (line: string) => {
    if (!line.trim()) return
    let msg: Message
    try {
      msg = JSON.parse(line) as Message
    } catch {
      send({ id: null, error: { code: -32700, message: 'parse error' } })
      return
    }
    if (typeof msg !== 'object' || msg === null || Array.isArray(msg)) {
      send({ id: null, error: { code: -32600, message: 'invalid request' } })
      return
    }
    const id = typeof msg.id === 'string' || typeof msg.id === 'number' ? (msg.id as Id) : undefined
    // Notifications (initialized, cancelled) and responses to requests we never send need no answer.
    if (id === undefined || typeof msg.method !== 'string') return
    const params =
      typeof msg.params === 'object' && msg.params !== null
        ? (msg.params as Record<string, unknown>)
        : {}
    const p = handle(msg.method, params)
      .then(
        (result) => send({ id, result }),
        (e: unknown) => {
          if (e instanceof RpcError) send({ id, error: { code: e.code, message: e.message } })
          else {
            opts.log(`sigil mcp: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`)
            send({ id, error: { code: -32603, message: 'internal error' } })
          }
        },
      )
      .finally(() => pending.delete(p))
    pending.add(p)
  }

  const rl = createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY })
  rl.on('line', onLine)
  await new Promise<void>((done) => rl.once('close', done))
  await Promise.all(pending)
}

async function call(tools: Tool[], opts: ServeOptions, params: Record<string, unknown>) {
  const tool = tools.find((t) => t.name === params.name)
  if (!tool) throw new RpcError(-32602, `unknown tool: ${String(params.name)}`)
  // Bad arguments and expected failures are tool results, so the model can read them and retry.
  const fail = (text: string) => ({ content: [{ type: 'text', text }], isError: true })
  const args = tool.input.safeParse(params.arguments ?? {})
  if (!args.success) return fail(`invalid arguments: ${z.prettifyError(args.error)}`)
  try {
    const result = await tool.run(args.data as never, opts.catalog)
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      structuredContent: result,
    }
  } catch (e) {
    if (e instanceof CatalogError || e instanceof SourceError) return fail(e.message)
    throw e
  }
}
