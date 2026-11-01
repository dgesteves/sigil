# notes-mcp

An MCP server that gives AI assistants read access to the team's notes (`data/notes.json`).
It speaks MCP over stdio and is built on the official TypeScript SDK (v2).

```sh
npm install
npm start          # runs src/server.ts with Node's built-in TypeScript support
npm test           # spins the server up with the MCP client and exercises it
npm run typecheck
```

Register it with an MCP host:

```json
{ "mcpServers": { "notes": { "command": "node", "args": ["/path/to/notes-mcp/src/server.ts"] } } }
```

## Tools

| Tool | What it does |
| --- | --- |
| `list_notes` | Notes, most recently updated first, optionally filtered by `tag`. |
| `get_note` | One note with its full body, by `id`. |
