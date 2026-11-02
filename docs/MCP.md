# Sigil for agents: `sigil mcp`

`sigil mcp` is a stdio [MCP](https://modelcontextprotocol.io) server that lets a coding agent use the
Sigil catalog in the middle of a task: find capabilities for the project it is working in, read the
evidence behind them, and preview an install. It is read-only. It never writes to the project; the
person installs with the `sigil add` command the plan returns.

## Tools

| Tool | What it does |
| --- | --- |
| `recommend` | Reads the project's manifests and config files (`package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`, `pom.xml`, `Dockerfile`, ...) with the signatures in [`taxonomy/technologies.yaml`](../taxonomy/technologies.yaml), then returns capabilities for that stack, best evidence first. Every detected technology says why ("package.json → next"). |
| `search` | Free-text search with filters for type, technology, domain, target agent and `proven_only`. |
| `get` | The full record for one capability: limitations, permissions, payload digest, and the evidence for that exact digest (pass counts with and without it, the delta with its 95% interval, the canary run, the security scan, reviews). |
| `plan_install` | Runs the real install engine in memory, exactly like `sigil add --dry-run`: payload hashes are verified, and the result lists every file and settings merge per agent, the hook commands the agent would run, and conflicts. Nothing is written. |

Revoked and harmful capabilities never appear in `recommend` or `search`; `get` still explains them
by id. The server tells the agent that only uplift `proven` means agents measurably did better, so
`untested` and `inconclusive` are not passed off as endorsements.

## Add it to your agent

Sigil is not on npm yet. Until the first release, build it from a clone and point your agent at the
built CLI:

```sh
git clone https://github.com/dgesteves/sigil && cd sigil
pnpm install && pnpm build
# the server is now: node /absolute/path/to/sigil/packages/sigil/dist/cli.js mcp
```

After the release, replace `node /absolute/path/to/sigil/packages/sigil/dist/cli.js` with
`npx -y sigil@<version>` in the snippets below. Every location here is from
[AGENTS-MATRIX.md](AGENTS-MATRIX.md), which links the vendor documentation.

**Claude Code**

```sh
claude mcp add sigil -- node /absolute/path/to/sigil/packages/sigil/dist/cli.js mcp
```

or, shared with the team, in `.mcp.json`:

```json
{ "mcpServers": { "sigil": { "command": "node", "args": ["/absolute/path/to/sigil/packages/sigil/dist/cli.js", "mcp"] } } }
```

**Cursor**: the same `mcpServers` object in `.cursor/mcp.json`. **Gemini CLI**: the same object in
`.gemini/settings.json`.

**GitHub Copilot in VS Code**, `.vscode/mcp.json`:

```json
{ "servers": { "sigil": { "type": "stdio", "command": "node", "args": ["/absolute/path/to/sigil/packages/sigil/dist/cli.js", "mcp"] } } }
```

**OpenAI Codex**, `.codex/config.toml`:

```toml
[mcp_servers.sigil]
command = "node"
args = ["/absolute/path/to/sigil/packages/sigil/dist/cli.js", "mcp"]
```

**OpenCode**, `opencode.json`:

```json
{ "mcp": { "sigil": { "type": "local", "command": ["node", "/absolute/path/to/sigil/packages/sigil/dist/cli.js", "mcp"] } } }
```

## Options

- `--registry <url|path>` serves another registry: a `registry.json` URL (https only, pinned to a
  commit), a `registry.json` file, or a local Sigil checkout (the catalog is built in memory, which is
  handy while writing a capability). The default is `https://sigil-lab.vercel.app/registry.json`.
- Stack detection needs the technology list. Online it is read from `taxonomy.json` next to the
  registry; in a checkout, from `taxonomy/technologies.yaml`.

The registry and taxonomy are fetched once per server process. The project root is the nearest folder
above the working directory with a `sigil.lock.json` or `.git`; `recommend` reads nothing outside it.

## Protocol

MCP over stdio, newline-delimited JSON-RPC 2.0, protocol versions `2025-11-25` (preferred),
`2025-06-18`, `2025-03-26` and `2024-11-05`. Tool results carry the same object as JSON text and as
`structuredContent`. Bad arguments come back as tool errors (`isError: true`) the model can read and
correct, not as protocol errors. No dependencies beyond the CLI's own: the protocol layer is about 150
lines of Node in [`packages/sigil/src/mcp/server.ts`](../packages/sigil/src/mcp/server.ts).
