# Protocol eras and Streamable HTTP

Checked against `@modelcontextprotocol/server@2.4.0`, `@modelcontextprotocol/node@2.1.2` and the
2026-07-28 specification.

## Two eras, one server definition

| Era | Revisions | Opening | Session |
| --- | --- | --- | --- |
| legacy | 2024-10-07 through 2025-11-25 | `initialize` request + `notifications/initialized` | connection-scoped |
| modern | 2026-07-28 (current) | optional `server/discover`; every request carries `_meta["io.modelcontextprotocol/protocolVersion"]` | none: each request stands alone |

What follows from that:

- The SDK decides the era per connection (stdio) or per request (HTTP) **at the entry**, not in
  `McpServer`. A hand-built `McpServer` + `server.connect(transport)` stays 2025-era.
- Write one factory `() => McpServer` and give it to the entry. The same registrations serve both
  eras, so they cannot drift.
- Do not depend on connection state between tool calls. The modern protocol has no session; if a
  tool needs state across calls, return an explicit handle (an opaque id) and accept it as an
  argument, and validate it on every call.
- Server-initiated requests (sampling, elicitation, roots) do not exist on the modern wire. Handlers
  return `inputRequired({ inputRequests: {...}, requestState })`; the client fulfils them and retries
  the same call, and `ctx.mcpReq.inputResponses` carries the answers. `requestState` comes back from
  the client: integrity-protect it (HMAC/AEAD) if it influences anything.
- Deprecated as of 2026-07-28 (SEP-2577), still functional for at least twelve months: protocol
  logging (`sendLoggingMessage`, `ctx.mcpReq.log`), sampling, roots. On stdio log to stderr; on HTTP
  use your normal logging/OpenTelemetry.

## stdio

```ts
import { serveStdio } from '@modelcontextprotocol/server/stdio'

const handle = serveStdio(createServer, {
  legacy: 'serve', // default: also serve 2025-era clients. 'reject' = modern only.
  onerror: (err) => console.error('mcp transport error', err),
})
process.on('SIGINT', () => void handle.close())
```

The client side (for tests or your own host):

```ts
new Client({ name: 'host', version: '1.0.0' }) // default: 2025 initialize handshake
new Client(info, { versionNegotiation: { mode: 'auto' } }) // probe server/discover, fall back to initialize
new Client(info, { versionNegotiation: { mode: { pin: '2026-07-28' } } }) // modern only, never falls back
```

A pinned client against a 2025-only server fails with `SdkError` code `ERA_NEGOTIATION_FAILED`
("the server did not offer pinned protocol version 2026-07-28 via server/discover").

## Streamable HTTP

`createMcpHandler(factory, options)` returns a web-standard handler `{ fetch, close, ... }` that serves
2026-07-28 requests and, by default (`legacy: 'stateless'`), answers 2025-era traffic statelessly
from the same factory. `legacy: 'reject'` makes it modern-only.

Fetch-native runtimes (Workers, Deno, Bun, Hono via `c.req.raw`):

```ts
import {
  createMcpHandler,
  hostHeaderValidationResponse,
  localhostAllowedHostnames,
  localhostAllowedOrigins,
  originValidationResponse,
} from '@modelcontextprotocol/server'

const handler = createMcpHandler(createServer)

export default {
  async fetch(request: Request): Promise<Response> {
    // The entry does no Host/Origin validation. Add it, or a malicious page can reach a local server
    // through DNS rebinding.
    const rejected =
      hostHeaderValidationResponse(request, localhostAllowedHostnames()) ??
      originValidationResponse(request, localhostAllowedOrigins())
    return rejected ?? handler.fetch(request)
  },
}
```

Node (`node:http`, Express, Fastify): wrap once with `toNodeHandler` from `@modelcontextprotocol/node`.

```ts
import { createServer as createHttpServer } from 'node:http'
import { createMcpHandler } from '@modelcontextprotocol/server'
import {
  localhostHostValidation,
  localhostOriginValidation,
  toNodeHandler,
} from '@modelcontextprotocol/node'

const mcp = toNodeHandler(createMcpHandler(createServer))
const hostOk = localhostHostValidation()
const originOk = localhostOriginValidation()
createHttpServer((req, res) => {
  if (req.url !== '/mcp') return void res.writeHead(404).end()
  // Each guard answers 403 itself and returns false when it rejects the request.
  if (!hostOk(req, res) || !originOk(req, res)) return
  void mcp(req, res)
}).listen(3000, '127.0.0.1')
```

With Express, `app.all('/mcp', express.json(), (req, res) => mcp(req, res, req.body))`: the third
argument is an optional pre-parsed body; Express's `next` is ignored. `req.auth` is forwarded as
`authInfo`. `hostHeaderValidation(hostnames)` / `originValidation(hostnames)` are the configurable
versions of the two guards.

Rules that hold for every HTTP deployment:

- Bind local development servers to `127.0.0.1`, not `0.0.0.0`.
- Validate `Host` and `Origin`. The entry is "deliberately validation-free".
- Verify tokens before the handler (`requireBearerAuth`, `verifyBearerToken`); the entry passes
  `authInfo` through and never derives it from headers. Read it in handlers as `ctx.http?.authInfo`.
- Body size: `toNodeHandler` buffers at most 4 MiB by default (`maxRequestBodySize`); raise it together
  with the handler's own `maxRequestBodySize` only if you must.
- Sessionful 2025-era wiring (`NodeStreamableHTTPServerTransport` from `@modelcontextprotocol/node`,
  `WebStandardStreamableHTTPServerTransport` from `@modelcontextprotocol/server`) still exists for
  existing deployments; route with `isLegacyRequest()` in front of a strict modern handler if you keep it.
- `SSEServerTransport` was removed. `@modelcontextprotocol/server-legacy/sse` is a deprecated, frozen
  copy for migration only.
