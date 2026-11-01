import type { IncomingMessage, ServerResponse } from 'node:http'

export interface AppState {
  draining: boolean
  tallies: Map<string, number>
}

const NAME = /^[a-z0-9][a-z0-9-]{0,62}$/

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

export function createApp(state: AppState) {
  return function handle(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname === '/healthz') {
      // Report unhealthy while draining so load balancers stop sending traffic first.
      if (state.draining) return send(res, 503, { status: 'draining' })
      return send(res, 200, { status: 'ok' })
    }
    const m = /^\/v1\/tallies\/([^/]+)(\/increment)?$/.exec(url.pathname)
    if (!m || !NAME.test(m[1])) return send(res, 404, { error: 'not found' })
    const name = m[1]
    if (req.method === 'GET' && !m[2]) return send(res, 200, { name, count: state.tallies.get(name) ?? 0 })
    if (req.method === 'POST' && m[2]) {
      const by = Number(url.searchParams.get('by') ?? 1)
      if (!Number.isSafeInteger(by) || by < 1) return send(res, 400, { error: 'by must be a positive integer' })
      const count = (state.tallies.get(name) ?? 0) + by
      state.tallies.set(name, count)
      return send(res, 200, { name, count })
    }
    return send(res, 405, { error: 'method not allowed' })
  }
}
