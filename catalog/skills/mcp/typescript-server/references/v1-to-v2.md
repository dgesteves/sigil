# Porting from `@modelcontextprotocol/sdk` 1.x to the v2 packages

The v2 line splits the old single package into `@modelcontextprotocol/server`,
`@modelcontextprotocol/client` and `@modelcontextprotocol/core`, plus framework adapters
(`@modelcontextprotocol/node`, `/express`, `/hono`, `/fastify`). Checked against 2.4.0.

The upstream migration guide is the authority; this page lists what breaks most often and how it
shows up, so you can recognise it from the error.

## Symptoms -> cause

| Symptom | Cause | Fix |
| --- | --- | --- |
| `ERR_MODULE_NOT_FOUND: Cannot find package '@modelcontextprotocol/sdk'` | v1 import paths | import from `@modelcontextprotocol/server` / `/server/stdio` / `@modelcontextprotocol/client` / `/client/stdio` |
| `SyntaxError: ... does not provide an export named 'McpError'` | renamed | `ProtocolError`, `ProtocolErrorCode` |
| `TypeError: server.tool is not a function` (also `.resource`, `.prompt`) | variadic methods removed | `registerTool` / `registerResource` / `registerPrompt` |
| `TypeError: inputSchema/outputSchema/argsSchema must be a Standard Schema...` | JSON Schema literal passed | zod `z.object(...)` or `fromJsonSchema(json)` |
| `-32603 Schema appears to be from zod 3` on `tools/list` | zod 3 schema (`zod@3`, or `zod/v3`) | zod `>= 4.2` |
| tool result `isError: true`, text "...has an output schema but no structured content was provided" | `outputSchema` without `structuredContent` | return matching `structuredContent` |
| `TypeError: Cannot read properties of undefined (reading 'mcpReq')` inside a no-schema tool | handler written as `(args, ctx)` but the tool has no `inputSchema`, so the first argument *is* `ctx` | `(ctx) => ...` or add `inputSchema: z.object({})` |
| 2026-07-28 host cannot connect; `ERA_NEGOTIATION_FAILED` | `server.connect(new StdioServerTransport())` is 2025-only | `serveStdio(createServer)` |
| client code: `isError` check for an unknown tool never fires | unknown/disabled tools now **reject** with `ProtocolError(-32602)` | `try/catch` around `callTool` |

## Server API map

| v1 | v2 |
| --- | --- |
| `server.tool(name, desc, shape, cb)` | `server.registerTool(name, { description, inputSchema: z.object(shape) }, cb)` |
| `server.tool(name, desc, shape, annotations, cb)` | `annotations` moves into the config object |
| `server.registerTool(name, { inputSchema: shape })` | still accepted (`@deprecated` overload, auto-wrapped); prefer `z.object(shape)` |
| `server.resource(name, uri, cb)` / `(name, template, cb)` | `server.registerResource(name, uriOrTemplate, metadata, cb)`; `metadata` is required (`{}` if none) |
| `server.prompt(name, desc, shape, cb)` | `server.registerPrompt(name, { description, argsSchema: z.object(shape) }, cb)` |
| no-schema callback `(extra) => ...` | `(ctx) => ...` |
| `server.setRequestHandler(CallToolRequestSchema, (req, extra) => ...)` | `server.setRequestHandler('tools/call', (req, ctx) => ...)` (method string) |
| `*Schema` constants from `sdk/types.js` | `@modelcontextprotocol/core` |
| `ResourceTemplate` *type* from `types.js` (wire shape) | `ResourceTemplateType`; the `ResourceTemplate` helper class is unchanged |
| `new McpError(ErrorCode.InvalidParams, msg)` | `new ProtocolError(ProtocolErrorCode.InvalidParams, msg)` |
| `StreamableHTTPServerTransport` | `NodeStreamableHTTPServerTransport` (`@modelcontextprotocol/node`), `WebStandardStreamableHTTPServerTransport`, or `createMcpHandler` |
| `SSEServerTransport` | removed; `@modelcontextprotocol/server-legacy/sse` is a frozen, deprecated copy |

## `extra` -> `ctx`

| v1 `extra` | v2 `ctx` |
| --- | --- |
| `extra.signal` | `ctx.mcpReq.signal` |
| `extra._meta` | `ctx.mcpReq._meta` (reserved `io.modelcontextprotocol/*` keys lifted into `ctx.mcpReq.envelope`) |
| `extra.requestId` | `ctx.mcpReq.id` |
| `extra.sendNotification(n)` | `ctx.mcpReq.notify(n)` |
| `extra.sendRequest(req, ResultSchema)` | `ctx.mcpReq.send(req)` (no schema for spec methods) |
| `extra.authInfo` | `ctx.http?.authInfo` |
| `extra.requestInfo?.headers['x']` | `ctx.http?.req?.headers.get('x')` (`IsomorphicHeaders` removed) |
| `extra.sessionId` | `ctx.sessionId` |

## Behaviour changes that do not throw

- Thrown errors in tool handlers become `isError: true` results (except `UrlElicitationRequiredError`).
  Resource/prompt callbacks surface them as JSON-RPC errors (`ProtocolError` keeps its code; anything
  else is -32603).
- `resources/read` for an unknown URI answers -32602 (was -32002).
- `McpServer` advertises `tools`/`resources`/`prompts` with `listChanged: true` once you register
  them; pass `listChanged: false` in `capabilities` to opt out.
- Advertised `inputSchema` uses JSON Schema 2020-12 and no longer adds `additionalProperties: false`
  by default. Re-baseline snapshot tests.
- Output-schema validators compile lazily: a broken `outputSchema` shows up on the first `callTool`,
  not on `listTools`.
- `sendLoggingMessage` / `ctx.mcpReq.log`, sampling and roots are deprecated (SEP-2577).

## Client-side changes (tests and hosts)

- `client.callTool(params)` and `client.request(...)` take no result schema for spec methods.
- `listTools()` / `listResources()` / `listPrompts()` without a cursor fetch every page (capped by
  `listMaxPages`, default 64); they return empty results when the server did not advertise the
  capability (`enforceStrictCapabilities: true` restores the v1 throw).
- `structuredContent` is `unknown`; compare with `=== undefined` and narrow.
- The stdio client skips non-JSON stdout lines instead of throwing, and caps its read buffer at
  10 MB (`maxBufferSize`).
- `StreamableHTTPError` -> `SdkHttpError`, and its HTTP status moved from `.code` to `.status`.
- OAuth error subclasses -> one `OAuthError` with `OAuthErrorCode`; token verifiers must throw
  `OAuthError(OAuthErrorCode.InvalidToken)` or invalid tokens answer 500 instead of 401.

## Porting order that keeps the diff reviewable

1. Fix imports and package names; run the type checker to get the full list of breaks.
2. Mechanical method renames (`tool`/`resource`/`prompt`, error classes, `extra` -> `ctx`).
3. Re-check every tool without an `inputSchema` (handler argument order).
4. Switch the entry to `serveStdio(createServer)` / `createMcpHandler(createServer)` by moving
   registrations into a factory.
5. Run the end-to-end tests for both eras and the raw-stdout check
   ([testing.md](testing.md)). Compare outputs with the pre-port server where possible: a port should
   not change tool text, structured output, resource contents or prompt text.
