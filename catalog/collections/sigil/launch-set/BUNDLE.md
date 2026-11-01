# Sigil launch set

Seven skills for work where coding agents fail in predictable ways: an API changed after the model's
training data, a safe default is not the obvious one, or a correctness rule is easy to miss. Each skill
is a separate capability with its own digest, its own proof suite and its own results. This bundle
only groups them.

```sh
sigil add sigil/launch-set          # all seven, compiled for the agents this project uses
sigil add zod/zod-4 express/express-5   # or only the ones you need
```

## Members

| Capability | What it covers | Proof suite | The mistake its hardest task targets |
| --- | --- | --- | --- |
| `github-actions/workflow-hardening` | Script injection, `pull_request_target` and `workflow_run`, least-privilege tokens, SHA pins on current majors, OIDC and npm trusted publishing | `tasks/github-actions-hardening` | Silencing the `actions/checkout` v7 fork-PR refusal with `allow-unsafe-pr-checkout` instead of no longer running fork code with a write token; publishing with a stored `NPM_TOKEN` or on a Node 22 image whose npm 10 cannot use OIDC |
| `postgres/zero-downtime-migrations` | Lock levels, `lock_timeout`, `CREATE INDEX CONCURRENTLY`, `NOT VALID` then `VALIDATE`, PostgreSQL 18 not-null constraints, unique constraints `USING INDEX`, batched backfills | `tasks/postgres-zero-downtime` | Adding a uuid column with `DEFAULT gen_random_uuid()` (a volatile default rewrites the table), a direct `SET NOT NULL`, or a backfill in one transaction on a hot table |
| `mcp/typescript-server` | MCP servers on `@modelcontextprotocol/server` 2.x: `registerTool` with zod 4, `outputSchema` and `structuredContent`, `isError` results, listed resource templates, stdout hygiene | `tasks/mcp-typescript-server` | Porting v1 code but keeping `server.connect(new StdioServerTransport())`, which cannot serve clients on the 2026-07-28 protocol revision; `serveStdio` serves both eras |
| `ai-sdk/tools-and-structured-output` | Vercel AI SDK 7: `tool()` with `inputSchema`, `stopWhen` loops, `ToolLoopAgent`, `Output.object`, mock-model tests | `tasks/ai-sdk-tools` | Persisting `result.response.messages`, which holds only the final step in v7, so a multi-step turn drops its tool calls; v4-era `parameters` and `maxSteps`, which 7.x ignores without an error |
| `express/express-5` | path-to-regexp 8 routes, async error forwarding, safe JSON error handlers, the Express 4 to 5 changes | `tasks/express-5` | Fixing only the startup crashes of an Express 4 app: `res.send(404)`, `res.json(obj, 201)`, `redirect('back')`, the simple query parser and `extended: false` urlencoded parsing then change responses without throwing |
| `zod/zod-4` | Zod 4.6 at trust boundaries, error formatting, coercion, defaults, and the Zod 3 upgrade | `tasks/zod-4` | Keeping `required_error`/`invalid_type_error` or replacing them so that check messages are overridden, `.default()` that skips inner defaults, and the stricter `z.uuid()` |
| `react/accessible-widgets` | WAI-ARIA APG contracts for menu buttons, comboboxes, tabs, dialogs and disclosures in React 19, and how to test them in jsdom | `tasks/react-accessible-widgets` | The ARIA 1.1 combobox shape, a highlight that only CSS shows (no `aria-activedescendant`/`aria-selected`), and hard-coded ids that collide when two pickers share a page |

## How the members are proven

Every task in every suite has a prompt written like a real request, a starting repo, a hidden verifier
and a reference solution. `node tasks/_tools/check-task.mjs tasks/<suite>` runs setup and the verifier
inside the task's container image, with no network for the verifier, and requires the verifier to
fail on the untouched repo and to pass on the reference solution three times in a row. Uplift comes
only from `sigil prove` runs: baseline and treatment on the same tasks, scored by the hidden verifier.
Until those runs exist for a member's digest, its result is "untested".
