# relay-docs-mcp

MCP server that lets our support assistants search and quote the Relay product docs in `docs/`.
It runs over stdio inside the support desktop app and in a couple of internal agent workflows.

```sh
npm install
npm start          # node src/server.ts
npm test
npm run typecheck
```

## What it exposes

| Kind | Name | Notes |
| --- | --- | --- |
| tool | `search_docs` | `query` (required), `limit` (1-20, default 5). One line per matching page, best match first. |
| tool | `index_stats` | Page and word counts, as structured output. Sends progress notifications per page. |
| resource | `docs://{slug}` | The raw Markdown of one page. Every page is listed in `resources/list`. |
| prompt | `summarize_doc` | `slug`. Asks the model for a three-bullet customer summary of that page. |

## SDK upgrade

`package.json` now depends on the v2 SDK packages (`@modelcontextprotocol/server`, and
`@modelcontextprotocol/client` for the tests). The old `@modelcontextprotocol/sdk` package was
removed from the dependencies; `src/` has not been ported yet.
