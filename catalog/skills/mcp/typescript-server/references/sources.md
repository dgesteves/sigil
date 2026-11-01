# Sources

Checked on 2026-11-01. Where docs and code disagreed, the installed package won: every API named in
this skill was exercised against `@modelcontextprotocol/server@2.4.0`, `@modelcontextprotocol/client@2.4.0`,
`@modelcontextprotocol/node@2.1.2` and `zod@4.6.7` on Node 24, and v1 behaviour against
`@modelcontextprotocol/sdk@1.32.2`.

## Specification (revision 2026-07-28, current)

- Versioning and eras: https://modelcontextprotocol.io/specification/versioning
- stdio binding (stdout MUST rule, shutdown on EOF, era probing): https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/stdio.md
- Transports overview: https://modelcontextprotocol.io/specification/2026-07-28/basic/transports.md
- Tools (names, structuredContent, outputSchema, error kinds, annotations): https://modelcontextprotocol.io/specification/2026-07-28/server/tools.md

## TypeScript SDK

- Repository and README (v2 is the stable line; v1 support window): https://github.com/modelcontextprotocol/typescript-sdk
- v2 documentation: https://ts.sdk.modelcontextprotocol.io/v2/
- Upgrade guide v1 -> v2: https://ts.sdk.modelcontextprotocol.io/v2/migration/upgrade-to-v2
- Protocol versions and client negotiation: https://ts.sdk.modelcontextprotocol.io/v2/protocol-versions.md
- Serving over stdio (`serveStdio`): https://ts.sdk.modelcontextprotocol.io/v2/serving/stdio.html
- Supporting legacy clients: https://ts.sdk.modelcontextprotocol.io/v2/serving/legacy-clients.html
- Server errors (isError vs ProtocolError): https://ts.sdk.modelcontextprotocol.io/v2/servers/errors.html
- Tools: https://ts.sdk.modelcontextprotocol.io/v2/servers/tools.html
- First server tutorial: https://ts.sdk.modelcontextprotocol.io/v2/get-started/first-server.html

## Packages (npm, latest on 2026-11-01)

| Package | Version |
| --- | --- |
| `@modelcontextprotocol/server` | 2.4.0 |
| `@modelcontextprotocol/client` | 2.4.0 |
| `@modelcontextprotocol/core` | 2.4.0 |
| `@modelcontextprotocol/node` | 2.1.2 |
| `@modelcontextprotocol/express` | 2.0.2 |
| `@modelcontextprotocol/server-legacy` | 2.4.0 (deprecated: frozen v1 SSE + OAuth helpers) |
| `@modelcontextprotocol/sdk` | 1.32.2 (v1 line) |
| `zod` | 4.6.7 (v2 requires `^4.2.0`) |

## Behaviour verified by running it (not stated in the docs)

- `server.connect(new StdioServerTransport())` answers a client pinned to 2026-07-28 with
  `SdkError ERA_NEGOTIATION_FAILED`; `serveStdio(factory)` serves both that client and a default one.
- A stray `console.log` on stdout does not break the v2 client (it skips the line); the raw stream
  check in `testing.md` catches it.
- `.default()` and `.optional()` zod fields are omitted from the advertised `required` list.
- Progress notifications sent with `ctx.mcpReq.notify` reach the wire before the response in both
  eras (100 of 100 calls each), while the 2.4.0 client's `onprogress` fired between 0 and 4 times for
  4 notifications.
