# Working on Sigil

Sigil is the open proving ground for AI agent capabilities. It measures whether a skill, rule, hook,
agent or MCP server actually helps an agent, scans it for malicious behaviour, seals the exact content
it tested, and installs it into any coding agent. This file is the contract for humans and agents
working in this repo.

## Layout

| Path | What lives there |
| --- | --- |
| `packages/sigil/src/core` | Spec as code: zod schemas, ids, digest, loader, stats, levels, registry. No I/O beyond the filesystem. |
| `packages/sigil/src/scan` | `sigil scan`: static security analysis mapped to the OWASP Agentic Skills Top 10. |
| `packages/sigil/src/compile` | Adapters from native payloads to each agent's files. `sigil add/remove/list/init`. |
| `packages/sigil/src/lab` | `sigil prove`: sandboxed A/B runs, canary tripwires, traces, evidence. |
| `packages/sigil/src/cli` | Command router. One file per command in `commands/`, registered in `main.ts`. |
| `spec/` | Generated JSON Schemas (`pnpm --dir packages/sigil schemas`) plus the methodology and threat model. |
| `catalog/<type>/<namespace>/<slug>/` | Capabilities: `sigil.yaml` plus the native payload. |
| `tasks/<suite>/<task>/` | Proving-ground tasks: `task.yaml`, `repo/`, hidden `verify/`, reference `solution/`. |
| `site/` | The Sigil observatory (Next.js). Reads `registry.json`. |

## Commands

```sh
pnpm install
pnpm check                      # lint + typecheck + tests + build + validate the catalog
pnpm --dir packages/sigil test  # unit tests only
pnpm sigil validate catalog     # after a build
```

## Rules that are not negotiable

1. **Never fabricate evidence.** Uplift, canary, compatibility and review results come only from tool
   runs. An empty state ("untested") is always better than a plausible number.
2. **Verification is bound to a digest.** Any payload change invalidates evidence for the old digest.
   Do not add code paths that carry evidence across digests.
3. **Never execute capability content outside the lab sandbox.** Install never runs scripts. Scan
   never runs scripts. Only `sigil prove` executes, and only inside the sandbox.
4. **Secrets never enter the repo, traces or logs.** The lab redacts credentials before writing traces.
5. **Every rule ships with tests**: a positive fixture, a negative fixture, and a note on false positives.
6. **Dependencies are a cost.** Prefer the Node standard library. Add a dependency only when it removes
   real complexity, and say why in the PR.

## Style

- TypeScript strict, ESM, Node 22+. Biome formats and lints (`pnpm format`).
- Errors a user can act on are findings or messages, not stack traces.
- Comments explain why, not what. Match the density of the surrounding code.
- Conventional commits (`feat(scan): …`, `fix(core): …`, `docs: …`).
