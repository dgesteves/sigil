import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Socket } from 'node:net'

/**
 * The lab's egress proxy: an HTTP proxy (CONNECT for TLS, absolute-URI requests for plain HTTP)
 * that allows only an explicit host list and logs every attempt as one JSON line on stdout.
 *
 * It runs as its own process: in a sidecar container bridging the sandbox's internal network to
 * the internet (Docker runner), or as a child process on 127.0.0.1 (host runner). To ship the exact
 * same code to both without a separate build artifact, `proxyProgram` is serialized with
 * Function.prototype.toString. It must therefore stay self-contained: no references to anything
 * outside its own body, and builtins come from process.getBuiltinModule (a plain call that no
 * bundler or test transform rewrites, unlike import()).
 *
 * The allow list lives in a JSON file `{ "phase": "...", "allow": ["host", "host:port"] }` that is
 * re-read on SIGHUP, so the runner can switch from the setup policy to the agent policy without
 * exposing a control endpoint the agent could reach.
 */
export interface ProxyProgramConfig {
  bind: string
  port: number
  allowFile: string
}

export interface ProxyRecord {
  ts: number
  event: 'ready' | 'phase' | 'connect' | 'http' | 'close' | 'error' | 'config-error'
  phase?: string
  host?: string
  port?: number
  allowed?: boolean
  /** Request path for plain HTTP, truncated. TLS hides it, which is why CONNECT logs only the host. */
  path?: string
  method?: string
  status?: number
  up?: number
  down?: number
  error?: string
  allow?: string[]
}

export async function proxyProgram(config: ProxyProgramConfig): Promise<void> {
  const http = process.getBuiltinModule('node:http')
  const net = process.getBuiltinModule('node:net')
  const fs = process.getBuiltinModule('node:fs')

  let phase = 'init'
  let allow: string[] = []

  const log = (record: Record<string, unknown>) => {
    process.stdout.write(`${JSON.stringify({ ts: Date.now(), ...record })}\n`)
  }

  const load = () => {
    try {
      const parsed = JSON.parse(fs.readFileSync(config.allowFile, 'utf8')) as {
        phase?: unknown
        allow?: unknown
      }
      phase = typeof parsed.phase === 'string' ? parsed.phase : 'unknown'
      allow = Array.isArray(parsed.allow) ? parsed.allow.map((a) => String(a).toLowerCase()) : []
      log({ event: 'phase', phase, allow })
    } catch (e) {
      // Fail closed: an unreadable policy allows nothing.
      allow = []
      log({ event: 'config-error', phase, error: String(e) })
    }
  }

  const normalize = (host: string) =>
    host
      .trim()
      .toLowerCase()
      .replace(/^\[|\]$/g, '')
      .replace(/\.$/, '')

  const isAllowed = (host: string, port: number) =>
    allow.some((entry) => {
      const i = entry.lastIndexOf(':')
      const name = i > 0 ? entry.slice(0, i) : entry
      const wanted = i > 0 ? Number(entry.slice(i + 1)) : undefined
      if (name !== host) return false
      return wanted === undefined ? port === 443 || port === 80 : wanted === port
    })

  const server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
    let url: URL
    try {
      url = new URL(req.url ?? '')
    } catch {
      res
        .writeHead(400, { 'content-type': 'text/plain' })
        .end('proxy requests must use absolute URLs\n')
      return
    }
    req.on('error', () => res.destroy())
    res.on('error', () => req.destroy())
    const host = normalize(url.hostname)
    const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80))
    const path = `${url.pathname}${url.search}`.slice(0, 512)
    const allowed = url.protocol === 'http:' && isAllowed(host, port)
    log({ event: 'http', phase, method: req.method, host, port, path, allowed })
    if (!allowed) {
      res
        .writeHead(403, { 'content-type': 'text/plain' })
        .end('blocked by the sigil lab egress policy\n')
      return
    }
    const headers = { ...req.headers }
    delete headers['proxy-authorization']
    delete headers['proxy-connection']
    const upstream = http.request(
      { host, port, method: req.method, path, headers },
      (up: IncomingMessage) => {
        res.writeHead(up.statusCode ?? 502, up.headers)
        up.pipe(res)
      },
    )
    upstream.on('error', (e: Error) => {
      log({ event: 'error', phase, host, port, error: e.message })
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' })
      res.end()
    })
    req.pipe(upstream)
  })

  server.on('connect', (req: IncomingMessage, client: Socket, head: Buffer) => {
    // Clients reset sockets all the time (curl does on a 403). Without a listener that is a crash.
    client.on('error', () => client.destroy())
    const target = req.url ?? ''
    const i = target.lastIndexOf(':')
    const host = normalize(i > 0 ? target.slice(0, i) : target)
    const port = Number(i > 0 ? target.slice(i + 1) : 443)
    const allowed = Number.isInteger(port) && isAllowed(host, port)
    log({ event: 'connect', phase, host, port, allowed })
    if (!allowed) {
      client.end(
        'HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\nblocked by the sigil lab egress policy\n',
      )
      return
    }
    const started = Date.now()
    let up = head.length
    let down = 0
    const upstream = net.connect(port, host, () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      if (head.length) upstream.write(head)
      upstream.pipe(client)
      client.pipe(upstream)
    })
    client.on('data', (chunk: Buffer) => {
      up += chunk.length
    })
    upstream.on('data', (chunk: Buffer) => {
      down += chunk.length
    })
    const done = () => {
      client.destroy()
      upstream.destroy()
    }
    upstream.on('error', (e: Error) => {
      log({ event: 'error', phase, host, port, error: e.message })
      if (!client.destroyed) client.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n')
      done()
    })
    client.on('error', done)
    client.on('close', done)
    upstream.on('close', () => {
      log({ event: 'close', phase, host, port, up, down, ms: Date.now() - started })
      done()
    })
  })

  server.on('clientError', (_e: Error, socket: Socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n')
    else socket.destroy()
  })

  // The agent controls the client side, so it must not be able to take the proxy down: log and keep
  // serving. The policy is fail-closed either way.
  process.on('uncaughtException', (e: Error) =>
    log({ event: 'error', phase, error: `uncaught: ${e.message}` }),
  )

  process.on('SIGHUP', load)
  process.on('SIGTERM', () => {
    server.close()
    process.exit(0)
  })
  load()
  await new Promise<void>((resolve) => server.listen(config.port, config.bind, resolve))
  const address = server.address()
  log({ event: 'ready', port: typeof address === 'object' && address ? address.port : config.port })
}

/** A standalone program for `node -e`, with the config baked in. */
export function proxySource(config: ProxyProgramConfig): string {
  return `(${proxyProgram.toString()})(${JSON.stringify(config)}).catch((e) => { console.error(e); process.exit(1) })`
}

/** Parses the proxy's stdout. Non-JSON lines (a crash trace) are ignored, not trusted. */
export function parseProxyLog(output: string): ProxyRecord[] {
  const out: ProxyRecord[] = []
  for (const line of output.split('\n')) {
    if (!line.startsWith('{')) continue
    try {
      const r = JSON.parse(line) as ProxyRecord
      if (typeof r.ts === 'number' && typeof r.event === 'string') out.push(r)
    } catch {
      // A truncated last line while the proxy is being stopped.
    }
  }
  return out
}
