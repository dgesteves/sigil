# Agent capability matrix

Where 22 AI coding agents load skills, rules, commands, subagents, hooks, MCP servers, permission
policies and plugin packs, and how Sigil writes each one from a single source.

Every row was checked against the agent's official documentation on **2026-11-01**, and each row links
the page it came from. Formats changed a lot in 2026, so if a row no longer matches the docs, please
open an issue with the link. Paths are relative to the project root unless they start with `~`.
"Not documented" means the official docs do not say; it never means "probably works".

**Product changes in 2026 that this matrix reflects**

- **Windsurf** became **Devin Desktop** on 2026-06-02. Devin Local replaced the Cascade agent as the default, and the [official FAQ](https://docs.devin.ai/desktop/devin-desktop-faq) said Cascade would stay available through July 2026.
  Devin Desktop still imports `.windsurf/rules/` and `.windsurf/skills/`.
  ([changelog](https://docs.devin.ai/desktop/changelog))
- **Roo Code** was shut down on 2026-05-15 and its repository is archived.
  ([docs](https://roocodeinc.github.io/Roo-Code/))
- **Continue** has had no release since 2.0.0 (2026-06-19), and its main branch has had only documentation commits since July 2026. The repository is not archived.
  ([repo](https://github.com/continuedev/continue))
- **Gemini CLI** was replaced by Antigravity CLI for unpaid and Google One users on 2026-06-18.
  ([docs](https://geminicli.com/docs/cli/skills/))
- The **Copilot coding agent** was renamed **Copilot cloud agent**, and VS Code now runs agent sessions
  on a "Local" or a "Copilot" harness that load different files.
  ([changelog](https://github.blog/changelog/2026-04-10-copilot-usage-metrics-now-aggregate-copilot-cloud-agent-active-user-counts/),
  [harnesses](https://code.visualstudio.com/docs/agents/concepts/agent-harnesses))
- **Amp** removed custom commands in favour of skills on 2026-01-29.
  ([news](https://ampcode.com/news/slashing-custom-commands))
- Codex docs moved to `learn.chatgpt.com/docs` and Factory docs to `docs.factory.com`.

## What `sigil add` writes

`yes`: Sigil compiles this format for the agent. One capability can still be refused when it uses
something the agent cannot express; `sigil add` and `sigil export` print the reason. `no`: researched
and not supported, with the reason in the sections below. `?`: not researched yet, so Sigil reports it
as unsupported rather than guessing. This table is generated from the adapters
(`packages/sigil/src/compile`), and a test fails if it drifts.

<!-- sigil:matrix:begin -->
| Agent | Skills | Rules | Commands | Subagents | Hooks | MCP | Policy | Plugin |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| Claude Code | yes | yes | yes | yes | yes | yes | yes | yes |
| OpenAI Codex | yes | yes | no | yes | yes | yes | yes | no |
| Cursor | yes | yes | yes | yes | yes | yes | yes | no |
| GitHub Copilot | yes | yes | yes | yes | yes | yes | no | no |
| Gemini CLI | yes | yes | yes | yes | no | yes | no | no |
| OpenCode | yes | yes | yes | yes | no | yes | yes | no |
| Windsurf (Devin Desktop) | yes | yes | no | no | no | no | ? | ? |
| Cline | yes | yes | no | no | no | no | ? | ? |
| Roo Code | yes | yes | yes | no | no | yes | ? | ? |
| Kilo Code | yes | yes | yes | yes | no | yes | ? | ? |
| Amp | yes | yes | no | no | no | yes | ? | ? |
| Aider | no | no | no | no | no | no | ? | ? |
| Zed | yes | yes | no | no | no | yes | ? | ? |
| JetBrains Junie | yes | yes | yes | yes | no | yes | ? | ? |
| Kiro | yes | yes | no | yes | no | yes | ? | ? |
| Goose | yes | yes | no | yes | no | no | ? | no |
| Continue | no | yes | yes | no | no | yes | ? | ? |
| Augment Code | yes | yes | yes | yes | no | yes | ? | ? |
| Qwen Code | yes | yes | yes | yes | no | yes | ? | no |
| Factory Droid | yes | yes | yes | yes | no | yes | ? | ? |
| Trae | yes | yes | no | yes | no | yes | ? | ? |
| Warp | yes | yes | no | no | no | yes | ? | ? |
| Any AGENTS.md agent | yes | yes | no | no | no | no | ? | ? |

96 supported, 56 unsupported, 32 not researched.
<!-- sigil:matrix:end -->

Run `sigil init` in a project to see the exact target path for each agent it detects.

---

## Agent Skills

[Agent Skills](https://agentskills.io/specification) are folders with a `SKILL.md` (`name`, required,
1-64 lowercase characters matching the folder; `description`, required, up to 1,024 characters; optional
`license`, `compatibility`, `metadata`, `allowed-tools`) plus optional `scripts/`, `references/` and
`assets/`. The spec does not say where skills live; `.agents/skills/` is the
[shared convention](https://agentskills.io/client-implementation/adding-skills-support.md).

**Sigil:** the folder is copied byte for byte. Agents that read `.agents/skills/` share one copy;
Claude Code does not read it, so it gets `.claude/skills/`, which Cursor, Copilot, OpenCode, Amp,
Goose, Augment and Warp also read. A multi-agent install therefore writes at most two copies.

| Agent | Project | User | Notes | Source | Checked |
| --- | --- | --- | --- | --- | --- |
| Claude Code | `.claude/skills/<name>/` in the start directory and every parent up to the repo root; nested `.claude/skills/` load on demand | `~/.claude/skills/` | Does not read `.agents/skills/`. Extra fields: `when_to_use`, `argument-hint`, `paths`, `allowed-tools`, `model`, `context: fork`... | [skills](https://code.claude.com/docs/en/skills) | 2026-11-01 |
| OpenAI Codex | `.agents/skills/` in every directory from cwd up to the repo root | `~/.agents/skills/`; admin `/etc/codex/skills` | `.codex/skills/` loading was marked for deprecation (PR #10317). Optional `agents/openai.yaml` metadata. | [build-skills](https://learn.chatgpt.com/docs/build-skills) | 2026-11-01 |
| Cursor | `.agents/skills/`, `.cursor/skills/` (anywhere in the repo, scoped to that folder); also `.claude/skills/`, `.codex/skills/` | `~/.agents/skills/`, `~/.cursor/skills/`, `~/.claude/skills/`, `~/.codex/skills/` | Cloud agents sync only `~/.cursor/skills/`. `paths` scopes a skill to files. | [skills](https://cursor.com/docs/skills) | 2026-11-01 |
| GitHub Copilot | `.github/skills/`, `.claude/skills/`, `.agents/skills/` | `~/.copilot/skills/`, `~/.agents/skills/` | VS Code, cloud agent and CLI. CLI: first found wins on duplicate names. | [about skills](https://docs.github.com/en/copilot/concepts/agents/about-agent-skills) | 2026-11-01 |
| Gemini CLI | `.gemini/skills/` or the alias `.agents/skills/` | `~/.gemini/skills/`, `~/.agents/skills/` | On by default (`skills.enabled`). `.agents/skills/` wins within a tier. | [skills](https://geminicli.com/docs/cli/skills/) | 2026-11-01 |
| OpenCode | `.opencode/skills/`, `.claude/skills/`, `.agents/skills/`, from cwd up to the git worktree | `~/.config/opencode/skills/`, `~/.claude/skills/`, `~/.agents/skills/` | Singular `skill/` still loads. `OPENCODE_DISABLE_CLAUDE_CODE_SKILLS=1` turns off `.claude/skills`. | [skills](https://opencode.ai/docs/skills/) | 2026-11-01 |
| Windsurf (Devin Desktop) | `.devin/skills/`, `.agents/skills/`, legacy `.windsurf/skills/` | `~/.config/devin/skills/`, `~/.agents/skills/` | Legacy Cascade read `.windsurf/skills/` and `~/.codeium/windsurf/skills/`. | [skills](https://docs.devin.ai/desktop/cascade/skills) | 2026-11-01 |
| Cline | `.cline/skills/` (recommended), `.clinerules/skills/`, `.claude/skills/`; the config page also lists `.agents/skills/` | `~/.cline/skills/`, `~/.agents/skills/` | A global skill beats a project skill with the same name. | [skills](https://docs.cline.bot/customization/skills.md), [config](https://docs.cline.bot/getting-started/config.md) | 2026-11-01 |
| Roo Code | `.roo/skills/`, `.roo/skills-<mode>/`, `.agents/skills/`, `.agents/skills-<mode>/` | Same under `~/.roo/` and `~/.agents/` | Discontinued 2026-05-15. | [skills](https://roocodeinc.github.io/Roo-Code/features/skills) | 2026-11-01 |
| Kilo Code | `.kilo/skills/`, `.agents/skills/`; `.claude/skills/` with Claude Code compatibility on | `~/.kilo/skills/`, `~/.agents/skills/`, `~/.claude/skills/` | Extra paths with `skills.paths` in `kilo.jsonc`. | [skills](https://kilo.ai/docs/customize/skills) | 2026-11-01 |
| Amp | `.agents/skills/`, `.claude/skills/`, in the project and its parents | `~/.config/agents/skills/`, `~/.agents/skills/`, `~/.config/amp/skills/`, `~/.claude/skills/` | First skill found with a name wins. A skill can bundle MCP servers in a sibling `mcp.json`. | [skills](https://ampcode.com/docs/customize/skills) | 2026-11-01 |
| Aider | Not documented | Not documented | | [conventions](https://aider.chat/docs/usage/conventions.html) | 2026-11-01 |
| Zed | `.agents/skills/`, trusted worktrees only | `~/.agents/skills/` | Each skill must be a direct child of the skills root. | [skills](https://zed.dev/docs/ai/skills.md) | 2026-11-01 |
| JetBrains Junie | `.junie/skills/`; `.agents/skills/` in trusted projects | `~/.junie/skills/`, `~/.agents/skills/` | `.claude/skills` and `.cursor/skills` are only offered for import. `description` is optional. | [skills](https://junie.jetbrains.com/docs/agent-skills.html) | 2026-11-01 |
| Kiro | `.kiro/skills/` | `~/.kiro/skills/` | Custom agents need `skill://` resources to load skills. | [skills](https://kiro.dev/docs/skills/) | 2026-11-01 |
| Goose | `.agents/skills/` (recommended), `.goose/skills/`, `.claude/skills/` | `~/.agents/skills/`, `~/.claude/skills/` | Built-in Skills extension, on by default. | [skills](https://goose-docs.ai/docs/guides/context-engineering/using-skills) | 2026-11-01 |
| Continue | Not documented (source code reads `.continue/skills/` and `.claude/skills/`) | Not documented | No release since 2.0.0 (2026-06-19). | [PR #9353](https://github.com/continuedev/continue/pull/9353) | 2026-11-01 |
| Augment Code | `.augment/skills/`, `.claude/skills/`, `.agents/skills/`, from cwd up to the git root | `~/.augment/skills/`, `~/.claude/skills/`, `~/.agents/skills/` | User skills beat workspace skills. CLI invocation `/skill:<name>`. | [skills](https://docs.augmentcode.com/cli/skills.md) | 2026-11-01 |
| Qwen Code | `.qwen/skills/`, `.agents/skills/` | `~/.qwen/skills/`, `~/.agents/skills/` | `.claude/skills` only when added to `skills.directories`. | [skills](https://qwenlm.github.io/qwen-code-docs/en/users/features/skills/) | 2026-11-01 |
| Factory Droid | `.factory/skills/`, `.agents/skills/`, `.agent/skills/` | `~/.factory/skills/`, `~/.agents/skills/`, `~/.agent/skills/` | `.claude/skills` is not read. | [skills](https://docs.factory.com/harness/skills.md) | 2026-11-01 |
| Trae | `.trae/skills/`; `.agents/skills/` behind the "Enable .agents Skills Directory" switch | `~/.trae/skills/` | | [skills](https://docs.trae.ai/ide/skills) | 2026-11-01 |
| Warp | `.agents/skills/` (recommended), `.warp/skills/`, and the `.claude`, `.codex`, `.cursor`, `.gemini`, `.copilot`, `.factory`, `.github`, `.opencode` equivalents | The same names under `~/` | Global skills win on a name conflict. | [skills](https://docs.warp.dev/agents/capabilities/skills/) | 2026-11-01 |

## Rules and instructions

**Sigil:** a rule is markdown with Cursor-style frontmatter (`description`, `globs`, `alwaysApply`),
because that is the richest activation model in use. The activation is mapped to each agent's own
fields. Where an agent cannot scope a rule, it loads always (with a warning); a manual-only rule is
refused there rather than promoted to always-on. Shared files (`AGENTS.md`, `GEMINI.md`) get a marked
`<!-- sigil:begin <id> -->` block, which `sigil remove` takes out byte for byte.

| Activation | Cursor `.mdc` | Claude Code | Copilot | Windsurf | Kiro | Augment | Continue, Trae | Cline, Qwen Code | AGENTS.md, GEMINI.md, Roo, Junie |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Always | `alwaysApply: true` | no frontmatter | `applyTo: "**"` | `trigger: always_on` | `inclusion: always` | `type: always_apply` | `alwaysApply: true` | no frontmatter | block / file |
| Files (`globs`) | `globs: a,b` | `paths: [a, b]` | `applyTo: "a,b"` | `trigger: glob` (one glob) | `inclusion: fileMatch` | always, with a warning | `globs` | `paths: [a, b]` | always, with a warning |
| Agent decides (`description`) | `description` | always, with a warning | `description` (VS Code only) | `trigger: model_decision` | `inclusion: auto` | `type: agent_requested` | `description` | always, with a warning | always, with a warning |
| Manual | none of the above | refused | no `applyTo` (VS Code only) | `trigger: manual` | `inclusion: manual` | `type: manual` | Trae: `alwaysApply: false`; Continue: refused | refused | refused |

| Agent | Project | Scoping fields | User | Source | Checked |
| --- | --- | --- | --- | --- | --- |
| Claude Code | `CLAUDE.md`, `.claude/CLAUDE.md`, `CLAUDE.local.md`, `.claude/rules/**/*.md`; `AGENTS.md` when there is no `CLAUDE.md` (since 2.1.277) | `paths:` (list or comma-separated string; the only field read) | `~/.claude/CLAUDE.md`, `~/.claude/rules/` | [memory](https://code.claude.com/docs/en/memory) | 2026-11-01 |
| OpenAI Codex | `AGENTS.override.md` or `AGENTS.md` per directory, project root down to cwd | None (directory only). 32 KiB combined (`project_doc_max_bytes`) | `~/.codex/AGENTS.md` | [AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md) | 2026-11-01 |
| Cursor | `.cursor/rules/**/*.mdc` (plain `.md` is ignored); `AGENTS.md` at the root and in subdirectories; `.cursorrules` is legacy | `description`, `globs` (comma-separated string), `alwaysApply` | Customize → Rules (app setting) | [rules](https://cursor.com/docs/rules) | 2026-11-01 |
| GitHub Copilot | `.github/copilot-instructions.md`, `.github/instructions/**/*.instructions.md`, `AGENTS.md` (nearest wins); cloud agent and CLI also read `CLAUDE.md` and `GEMINI.md` | `applyTo` (comma-separated globs), `excludeAgent`; VS Code loads by `description` on demand | `~/.copilot/copilot-instructions.md` | [repository instructions](https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions), [VS Code](https://code.visualstudio.com/docs/copilot/customization/custom-instructions) | 2026-11-01 |
| Gemini CLI | `GEMINI.md` in the workspace and its parents; subdirectory files load when a tool touches them | None. `context.fileName` can add `AGENTS.md`; `@file` imports | `~/.gemini/GEMINI.md` | [GEMINI.md](https://geminicli.com/docs/cli/gemini-md/) | 2026-11-01 |
| OpenCode | `AGENTS.md` (or `CLAUDE.md` when there is no `AGENTS.md`); `instructions` array in `opencode.json` (paths, globs, URLs) | None | `~/.config/opencode/AGENTS.md` | [rules](https://opencode.ai/docs/rules/) | 2026-11-01 |
| Windsurf (Devin Desktop) | `.devin/rules/*.md`; legacy `.windsurf/rules/*.md` and `.windsurfrules` are imported; `AGENTS.md` | `trigger: always_on, model_decision, glob, manual`, `globs`, `description`; 12,000 characters per legacy file | `~/.devin/global_rules.md` | [memories](https://docs.devin.ai/desktop/cascade/memories) | 2026-11-01 |
| Cline | `.clinerules/` or `.cline/rules/`; `AGENTS.md`; `.cursorrules` and `.windsurfrules` are detected | `paths:` (YAML list) | `~/Documents/Cline/Rules`, `~/.cline/rules/` | [rules](https://docs.cline.bot/customization/cline-rules.md) | 2026-11-01 |
| Roo Code | `.roo/rules/`, `.roo/rules-<mode>/`, `.roorules`; `AGENTS.md` at the root | None | `~/.roo/rules/` | [instructions](https://roocodeinc.github.io/Roo-Code/features/custom-instructions) | 2026-11-01 |
| Kilo Code | `AGENTS.md` (always loaded); `instructions` in `kilo.jsonc`; legacy `.kilocode/rules/` | None documented | `instructions` in `~/.config/kilo/kilo.jsonc` | [rules](https://kilo.ai/docs/customize/custom-rules), [AGENTS.md](https://kilo.ai/docs/customize/agents-md) | 2026-11-01 |
| Amp | `AGENTS.md` (else `AGENT.md` or `CLAUDE.md`) from cwd up to `$HOME`; subtrees on demand | `globs:` only on files @-mentioned from AGENTS.md | `~/.config/amp/AGENTS.md` | [AGENTS.md](https://ampcode.com/docs/customize/agents-md) | 2026-11-01 |
| Aider | Only files named with `read:` in `.aider.conf.yml` or `--read` | None | `~/.aider.conf.yml` | [conventions](https://aider.chat/docs/usage/conventions.html) | 2026-11-01 |
| Zed | The first of `.rules`, `.cursorrules`, `.windsurfrules`, `.clinerules`, `.github/copilot-instructions.md`, `AGENT.md`, `AGENTS.md`, `CLAUDE.md`, `GEMINI.md` | None | `~/.config/zed/AGENTS.md` | [instructions](https://zed.dev/docs/ai/instructions.md) | 2026-11-01 |
| JetBrains Junie | `.junie/AGENTS.md` (used exclusively), else `AGENTS.md` + `.junie/playbook.md` + `.junie/rules/*.md`; legacy `.junie/guidelines.md` | None | `~/.junie/AGENTS.md` | [guidelines](https://junie.jetbrains.com/docs/guidelines-and-memory.html) | 2026-11-01 |
| Kiro | `.kiro/steering/*.md`; `AGENTS.md` (always included) | `inclusion: always, fileMatch (fileMatchPattern), manual, auto (name, description)` | `~/.kiro/steering/` | [steering](https://kiro.dev/docs/steering/) | 2026-11-01 |
| Goose | `AGENTS.md`, then `.goosehints`, from cwd up to the repo root; nested files on demand | None. `CONTEXT_FILE_NAMES` changes the names | `~/.config/goose/.goosehints` | [goosehints](https://goose-docs.ai/docs/guides/context-engineering/using-goosehints) | 2026-11-01 |
| Continue | `.continue/rules/*.md` | `name`, `globs` (string or list), `regex`, `description`, `alwaysApply` | `~/.continue/rules` (source code) | [rules](https://docs.continue.dev/customize/deep-dives/rules) | 2026-11-01 |
| Augment Code | `.augment/rules/**/*.md`, `.augment-guidelines`, `AGENTS.md` (else `CLAUDE.md`) in each directory | `type: always_apply, agent_requested, manual`, `description` | `~/.augment/rules/` | [rules](https://docs.augmentcode.com/cli/rules.md) | 2026-11-01 |
| Qwen Code | `QWEN.md` hierarchy; `.qwen/rules/**/*.md` in trusted workspaces | `paths:` (list), `description` | `~/.qwen/QWEN.md`, `~/.qwen/rules/` | [rules](https://qwenlm.github.io/qwen-code-docs/en/users/features/rules/) | 2026-11-01 |
| Factory Droid | `AGENTS.md` or `CLAUDE.md`, from cwd up to the git root, also inside `.factory/` and `.agents/` | None | `~/.factory/`, `~/.agents/` | [AGENTS.md](https://docs.factory.com/harness/agents-md.md) | 2026-11-01 |
| Trae | `.trae/rules/*.md` (three levels, also per subdirectory); `AGENTS.md` and `CLAUDE.md` behind import switches | `alwaysApply`, `description`, `globs` (comma-separated) | `~/.trae/user_rules` | [rules](https://docs.trae.ai/ide/rules) | 2026-11-01 |
| Warp | `AGENTS.md` (legacy `WARP.md` wins when both exist) | None | Warp Drive (no file) | [rules](https://docs.warp.dev/agents/capabilities/rules/) | 2026-11-01 |
| Any AGENTS.md agent | `AGENTS.md` | None | | [agents.md](https://agents.md/) | 2026-11-01 |

Two side effects Sigil warns about: OpenCode and Amp read `CLAUDE.md` only while there is no
`AGENTS.md`, so creating `AGENTS.md` changes what they load; and Zed reads only the first file in its
list, so an existing `.rules` or `.cursorrules` hides `AGENTS.md` from it.

## Commands and prompts

**Sigil:** a command is a Claude Code command file (`description`, `argument-hint`, `$ARGUMENTS`).
`$ARGUMENTS` is translated only where an agent documents a placeholder for the typed text (`{{args}}`
in Gemini CLI and Qwen Code). Positional placeholders are refused outside Claude Code because agents
number them differently (Claude Code counts from `$0`). Shell injection (``!`cmd` ``) is kept only for
OpenCode, which runs it the same way. Text that Gemini CLI or Qwen Code would execute (`!{`, `@{`) is
refused, so literal text never becomes a command.

| Agent | Project | User | Format and placeholders | Source | Checked |
| --- | --- | --- | --- | --- | --- |
| Claude Code | `.claude/commands/**/*.md` (merged into skills, still loaded) | `~/.claude/commands/` | `description`, `argument-hint`, `allowed-tools`, `model`; `$ARGUMENTS`, `$N` (from `$0`), ``!`cmd` ``; subfolders namespace as `/dir:name` | [skills](https://code.claude.com/docs/en/skills) | 2026-11-01 |
| OpenAI Codex | None | `~/.codex/prompts/*.md` | Deprecated in favour of skills. `description`, `argument-hint`; `$1`-`$9`, `$ARGUMENTS`, named `$FOO` | [custom prompts](https://learn.chatgpt.com/docs/custom-prompts) | 2026-11-01 |
| Cursor | `.cursor/commands/*.md` | Not documented | Plain markdown; placeholders not documented. The dedicated docs page was removed; `/migrate-to-skills` converts commands. | [1.6 changelog](https://cursor.com/changelog/1-6), [deeplinks](https://cursor.com/docs/reference/deeplinks) | 2026-11-01 |
| GitHub Copilot | `.github/prompts/*.prompt.md` (VS Code Local harness only) | VS Code profile | `description`, `name`, `argument-hint`, `agent`, `model`, `tools`; `${input:name}`, `${selection}`; no placeholder for typed text | [prompt files](https://code.visualstudio.com/docs/copilot/customization/prompt-files) | 2026-11-01 |
| Gemini CLI | `.gemini/commands/**/*.toml` | `~/.gemini/commands/` | `prompt`, `description`; `{{args}}`, `!{cmd}`, `@{path}`; `git/commit.toml` is `/git:commit` | [custom commands](https://geminicli.com/docs/cli/custom-commands/) | 2026-11-01 |
| OpenCode | `.opencode/commands/*.md` | `~/.config/opencode/commands/` | `description`, `agent`, `model`, `subtask`; `$ARGUMENTS`, `$1`, ``!`cmd` ``, `@file` | [commands](https://opencode.ai/docs/commands/) | 2026-11-01 |
| Windsurf (Devin Desktop) | `.windsurf/workflows/*.md`, `.devin/workflows/` | `~/.codeium/windsurf/global_workflows/` | Cascade only; Devin Local does not run workflows | [workflows](https://docs.devin.ai/desktop/cascade/workflows) | 2026-11-01 |
| Cline | `.cline/workflows/` (legacy `.clinerules/workflows/`) | `~/.cline/workflows/` | File format not documented on current pages | [config](https://docs.cline.bot/getting-started/config.md) | 2026-11-01 |
| Roo Code | `.roo/commands/*.md` | `~/.roo/commands/` | `description`, `argument-hint`, `mode`; placeholders not documented | [slash commands](https://roocodeinc.github.io/Roo-Code/features/slash-commands) | 2026-11-01 |
| Kilo Code | `.kilo/commands/*.md` (legacy `.kilocode/workflows/` migrated) | `~/.config/kilo/commands/` | `description`, `agent`, `model`, `variant`, `subtask`; placeholders not documented | [workflows](https://kilo.ai/docs/customize/workflows) | 2026-11-01 |
| Amp | Removed 2026-01-29 | | Skills replace them | [news](https://ampcode.com/news/slashing-custom-commands) | 2026-11-01 |
| Aider | None | | | [options](https://aider.chat/docs/config/options.html) | 2026-11-01 |
| Zed | Skills appear as slash commands | | | [skills](https://zed.dev/docs/ai/skills.md) | 2026-11-01 |
| JetBrains Junie | `.junie/commands/*.md` | `~/.junie/commands/` | `description`, `allowPromptArgument`; named `$arg` placeholders, all required | [commands](https://junie.jetbrains.com/docs/custom-slash-commands.html) | 2026-11-01 |
| Kiro | `.kiro/prompts/` (CLI) | `~/.kiro/prompts/` | File format not documented; `$ARGUMENTS`, `${1}` | [prompts](https://kiro.dev/docs/cli/chat/manage-prompts/) | 2026-11-01 |
| Goose | None | `slash_commands` in `~/.config/goose/config.yaml` point at recipes | | [slash commands](https://goose-docs.ai/docs/guides/context-engineering/slash-commands/) | 2026-11-01 |
| Continue | `.continue/prompts/*.md` with `invokable: true` | `~/.continue/prompts` | `name`, `description`; placeholders not documented | [prompts](https://docs.continue.dev/customize/deep-dives/prompts) | 2026-11-01 |
| Augment Code | `.augment/commands/*.md`; also reads `.claude/commands/`, `.agents/commands/` | `~/.augment/commands/` | `description`, `argument-hint`, `model`; `$ARGUMENTS`, `$1` | [commands](https://docs.augmentcode.com/cli/custom-commands.md) | 2026-11-01 |
| Qwen Code | `.qwen/commands/**/*.md` (TOML deprecated) | `~/.qwen/commands/` | `description`; `{{args}}`, `!{cmd}`, `@{path}` | [commands](https://qwenlm.github.io/qwen-code-docs/en/users/features/commands/) | 2026-11-01 |
| Factory Droid | `.factory/commands/*.md` or executables | `~/.factory/commands/` | `description`, `argument-hint`; `$ARGUMENTS` only | [commands](https://docs.factory.com/harness/custom-slash-commands.md) | 2026-11-01 |
| Trae | `.trae/commands/*.md` | `~/.trae/commands/` | Frontmatter keys and placeholders not documented | [slash commands](https://docs.trae.ai/ide/slash-commands) | 2026-11-01 |
| Warp | None | | Skills double as commands; saved prompts live in Warp Drive | [slash commands](https://docs.warp.dev/agents/capabilities/slash-commands/) | 2026-11-01 |

## Subagents and custom agents

**Sigil:** a subagent is a Claude Code subagent file. `name`, `description` and the prompt are
translated; model ids and other agent-specific fields are left out with a note. A `tools` list is a
security boundary, so it is never dropped: agents that cannot express the same restriction are
refused. Copilot accepts Claude Code tool names as aliases, so the list is kept there.

| Agent | Project | User | Format | Source | Checked |
| --- | --- | --- | --- | --- | --- |
| Claude Code | `.claude/agents/*.md` | `~/.claude/agents/` | `name`, `description` (required); `tools`, `model`, `permissionMode`, `skills`, `mcpServers`, `hooks`... | [subagents](https://code.claude.com/docs/en/sub-agents) | 2026-11-01 |
| OpenAI Codex | `.codex/agents/*.toml` | `~/.codex/agents/` | `name`, `description`, `developer_instructions` (required); cannot override sandbox or MCP | [subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents) | 2026-11-01 |
| Cursor | `.cursor/agents/`, `.claude/agents/`, `.codex/agents/` | The same under `~/` | `name`, `description`, `model`, `readonly`, `is_background`; no tools field | [subagents](https://cursor.com/docs/subagents) | 2026-11-01 |
| GitHub Copilot | `.github/agents/*.agent.md`; CLI and VS Code also `.claude/agents/` | `~/.copilot/agents/`; org `.github` repo `/agents/` | `name`, `description`, `tools` (aliases such as `read`, `edit`, `execute`; Claude names accepted), `target`, `model`, `mcp-servers` | [custom agents](https://docs.github.com/en/copilot/reference/custom-agents-configuration) | 2026-11-01 |
| Gemini CLI | `.gemini/agents/*.md` | `~/.gemini/agents/` | `name`, `description` (required); `kind`, `tools`, `model`, `temperature`, `max_turns`; on by default | [subagents](https://geminicli.com/docs/core/subagents/) | 2026-11-01 |
| OpenCode | `.opencode/agents/*.md` | `~/.config/opencode/agents/` | `description` (required), `mode: primary, subagent, all`, `model`, `permission` (`tools` deprecated) | [agents](https://opencode.ai/docs/agents/) | 2026-11-01 |
| Windsurf (Devin Desktop) | `.devin/agents/<name>.md` (Devin) | `~/.config/devin/agents/` | Cascade had no file-defined subagents | [Devin subagents](https://docs.devin.ai/cli/subagents.md) | 2026-11-01 |
| Cline | `.cline/agents/` | `~/.cline/agents/` | File format not documented | [subagents](https://docs.cline.bot/features/subagents.md) | 2026-11-01 |
| Roo Code | Custom modes in `.roomodes` (YAML or JSON) | `custom_modes.yaml` | A different concept: modes with tool groups | [custom modes](https://roocodeinc.github.io/Roo-Code/features/custom-modes) | 2026-11-01 |
| Kilo Code | `.kilo/agents/*.md` (legacy `.kilocode/agents/`) | `~/.config/kilo/agents/` | `description`, `mode`, `model`, `permission` (OpenCode style) | [subagents](https://kilo.ai/docs/customize/custom-subagents) | 2026-11-01 |
| Amp | Plugin code only | | | [subagents](https://ampcode.com/docs/models-and-subagents) | 2026-11-01 |
| Aider | None | | | | 2026-11-01 |
| Zed | None (agent profiles in `agent.profiles` settings) | | | [profiles](https://zed.dev/docs/ai/agent-profiles.md) | 2026-11-01 |
| JetBrains Junie | `.junie/agents/*.md`, `.agents/` (CLI) | `~/.junie/agents/` | `description` (required), `name`, `tools`, `model`, `permissionMode`... | [subagents](https://junie.jetbrains.com/docs/junie-cli-subagents.html) | 2026-11-01 |
| Kiro | `.kiro/agents/*.json` or `*.md`, trusted workspaces | `~/.kiro/agents/` | `name`, `description`, `tools`, `resources`, `mcpServers`, `hooks`, `permissions` | [custom agents](https://kiro.dev/docs/custom-agents/creating/) | 2026-11-01 |
| Goose | `.agents/agents/*.md`; also `.goose/agents/`, `.claude/agents/` | `~/.agents/agents/` | `name` (required), `description`, `model` | [custom agents](https://goose-docs.ai/docs/guides/context-engineering/custom-agents/) | 2026-11-01 |
| Continue | Not documented | | | [reference](https://docs.continue.dev/reference) | 2026-11-01 |
| Augment Code | `.augment/agents/*.md` | `~/.augment/agents/` | `name`, `description`, `model`, `tools`, `max_turns`... | [subagents](https://docs.augmentcode.com/cli/subagents.md) | 2026-11-01 |
| Qwen Code | `.qwen/agents/*.md` | `~/.qwen/agents/` | `name`, `description`, `tools`, `model`, plus Claude Code-compatible fields | [subagents](https://qwenlm.github.io/qwen-code-docs/en/users/features/sub-agents/) | 2026-11-01 |
| Factory Droid | `.factory/droids/*.md` | `~/.factory/droids/` | `name` (required), `description`, `model`, `reasoningEffort`, `tools` (category or ids); body required | [droids](https://docs.factory.com/harness/subagents.md) | 2026-11-01 |
| Trae | `.trae/agents/*.md` (switch "Enable Subagents Directory") | Printed as `~/.trae-cn/agents/` | `name`, `description` (required), `model`, `tools`, `disallowedTools`, `mcpServers` | [subagents](https://docs.trae.ai/ide/subagents?_lang=en) | 2026-11-01 |
| Warp | None (profiles live in app settings) | | | [profiles](https://docs.warp.dev/agents/capabilities/agent-profiles-permissions/) | 2026-11-01 |

## Hooks

**Sigil:** a hook capability is `hook.json` in the shape of Claude Code's `hooks` settings plus the
scripts it runs, and the scripts speak Claude Code's hook protocol (JSON on stdin, exit code 2 blocks).
That protocol is what other agents document compatibility with, so Sigil compiles hooks only there:

- **Claude Code**: merged into `.claude/settings.json`, scripts under `.claude/hooks/<slug>/`, paths
  through `${CLAUDE_PROJECT_DIR}`.
- **Cursor**: the same `.claude/settings.json` entry, which Cursor runs through its documented Claude
  Code compatibility (on by default). Notification hooks and the Glob tool are not mapped, so they are
  refused.
- **GitHub Copilot**: `.github/hooks/<slug>.json`. PascalCase event names select Copilot's
  Claude-compatible payload and matcher semantics.
- **Codex**: `.codex/hooks.json`, which has the same structure and event names. Matchers are anchored,
  and only `Bash` and `mcp__` tools are allowed, because those are the tools whose input Codex documents
  as matching.

Only `./relative` paths to files in the payload are rewritten, and the install preview prints every
command a hook will run. Sigil never runs them.

| Agent | Project | User | Format | Source | Checked |
| --- | --- | --- | --- | --- | --- |
| Claude Code | `hooks` in `.claude/settings.json`, `.claude/settings.local.json` | `~/.claude/settings.json` | `{event: [{matcher, hooks: [{type: "command", command, timeout}]}]}`; 33 events; `${CLAUDE_PROJECT_DIR}` | [hooks](https://code.claude.com/docs/en/hooks) | 2026-11-01 |
| OpenAI Codex | `.codex/hooks.json` or `[hooks]` in `.codex/config.toml`, trusted projects | `~/.codex/hooks.json` | Claude-shaped; 12 events; regex matcher; tools `Bash`, `apply_patch`, `mcp__…`; new hooks need approval in `/hooks` | [hooks](https://learn.chatgpt.com/docs/hooks) | 2026-11-01 |
| Cursor | `.cursor/hooks.json` (trusted workspace); also runs `.claude/settings*.json` hooks | `~/.cursor/hooks.json` | `{version: 1, hooks: {afterFileEdit: [{command}]}}`; 21 camelCase events; project hooks run from the project root | [hooks](https://cursor.com/docs/hooks), [Claude hooks](https://cursor.com/docs/reference/third-party-hooks) | 2026-11-01 |
| GitHub Copilot | `.github/hooks/*.json` (the only source for the cloud agent); the CLI also reads `.github/copilot/settings.json` and `.claude/settings.json` | `~/.copilot/hooks/` | `{version: 1, hooks: {preToolUse: [{type, bash, powershell, cwd, timeoutSec, matcher}]}}`; CLI and cloud agent, VS Code in preview | [hooks reference](https://docs.github.com/en/copilot/reference/hooks-reference) | 2026-11-01 |
| Gemini CLI | `hooks` in `.gemini/settings.json` | `~/.gemini/settings.json` | `BeforeTool`, `AfterTool`, `BeforeAgent`...; timeouts in ms; `$GEMINI_PROJECT_DIR` (`$CLAUDE_PROJECT_DIR` alias); changed project hooks prompt again | [hooks](https://geminicli.com/docs/hooks/) | 2026-11-01 |
| OpenCode | JS/TS plugins in `.opencode/plugins/` | `~/.config/opencode/plugins/` | Code, e.g. `tool.execute.before` | [plugins](https://opencode.ai/docs/plugins/) | 2026-11-01 |
| Windsurf (Devin Desktop) | Legacy `.windsurf/hooks.json`; Devin `.devin/hooks.v1.json` | `~/.codeium/windsurf/hooks.json` | Cascade events `pre_run_command`, `post_write_code`...; Devin uses `PreToolUse`-style events | [hooks](https://docs.windsurf.com/pt-BR/windsurf/cascade/hooks.md) | 2026-11-01 |
| Cline | `.cline/hooks/` | `~/.cline/hooks/` | File format not documented; SDK plugins in code | [hooks](https://docs.cline.bot/customization/hooks.md) | 2026-11-01 |
| Roo Code | None | | | | 2026-11-01 |
| Kilo Code | JS/TS plugins in `.kilo/plugin/` | `~/.config/kilo/plugin/` | Code | [plugins](https://kilo.ai/docs/automate/extending/plugins) | 2026-11-01 |
| Amp | Plugin event handlers in `.amp/plugins/` | `~/.config/amp/plugins/` | Code | [plugins](https://ampcode.com/docs/customize/plugins) | 2026-11-01 |
| Aider | None (`--lint-cmd`, `--test-cmd` only) | | | [lint and test](https://aider.chat/docs/usage/lint-test.html) | 2026-11-01 |
| Zed | Not documented | | | | 2026-11-01 |
| JetBrains Junie | Ignored in projects by default | `hooks` in `~/.junie/config.json` | Claude-shaped | [hooks](https://junie.jetbrains.com/docs/junie-cli-hooks.html) | 2026-11-01 |
| Kiro | `.kiro/hooks/*.json` | `~/.kiro/hooks/` (CLI v3) | `{version: "v1", hooks: [{name, trigger, matcher, action: {type, command}}]}` | [hooks](https://kiro.dev/docs/hooks/) | 2026-11-01 |
| Goose | Only inside plugins: `.agents/plugins/<name>/hooks/hooks.json` | `~/.agents/plugins/` | Claude-shaped | [hooks](https://goose-docs.ai/docs/guides/context-engineering/hooks/) | 2026-11-01 |
| Continue | CLI loads Claude-style settings hooks but does not fire them yet | | | [PR #13440](https://github.com/continuedev/continue/pull/13440) | 2026-11-01 |
| Augment Code | `hooks` in `.augment/settings.json` | `~/.augment/settings.json` | `PreToolUse`, `PostToolUse`, `Stop`, `SessionStart`, `SessionEnd`, `PromptSubmit`, `Notification`; timeouts in ms | [hooks](https://docs.augmentcode.com/cli/hooks.md) | 2026-11-01 |
| Qwen Code | `hooks` in `.qwen/settings.json`, trusted folders | `~/.qwen/settings.json` | Claude event names with Qwen tool names | [hooks](https://qwenlm.github.io/qwen-code-docs/en/users/features/hooks/) | 2026-11-01 |
| Factory Droid | `.factory/hooks.json` | `~/.factory/hooks.json` | Claude-shaped; shell tool is `Execute`; `$FACTORY_PROJECT_DIR` | [hooks](https://docs.factory.com/harness/hooks.md) | 2026-11-01 |
| Trae | `.trae/hooks.json` | `~/.trae/hooks.json` | `{version: 1, hooks: {...}}`, Claude-shaped | [hooks](https://docs.trae.ai/ide/hook-configuration-reference) | 2026-11-01 |
| Warp | Not shipped (draft pull requests only) | | | [issue #7834](https://github.com/warpdotdev/warp/issues/7834) | 2026-11-01 |

## MCP servers

**Sigil:** an MCP server capability is a [`server.json`](https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json)
in the official MCP registry format. Sigil starts a pinned package (`npx -y pkg@version`,
`uvx pkg==version`, or `docker run -i --rm image`) or connects to a fixed https remote. Secrets are
never written: a required environment variable is referenced by name in the agent's own syntax, and
agents that cannot reference environment variables are refused for servers that need one. The server's
own code is not part of the sealed payload, and the preview says so.

| Agent | Project | User | Shape and variables | Source | Checked |
| --- | --- | --- | --- | --- | --- |
| Claude Code | `.mcp.json` (`mcpServers`) | `~/.claude.json` (user and local scopes) | `command`, `args`, `env`; `type: http, sse, ws` + `url`, `headers`; `${VAR}`, `${VAR:-default}`; approval prompt per project | [MCP](https://code.claude.com/docs/en/mcp) | 2026-11-01 |
| OpenAI Codex | `[mcp_servers.<name>]` in `.codex/config.toml`, trusted projects | `~/.codex/config.toml` | `command`, `args`, `env`, `env_vars`; `url`, `bearer_token_env_var`, `http_headers` | [MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli), [config reference](https://learn.chatgpt.com/docs/config-file/config-reference) | 2026-11-01 |
| Cursor | `.cursor/mcp.json` (`mcpServers`) | `~/.cursor/mcp.json` | `command`, `args`, `env`, `envFile`; `url`, `headers`; `${env:NAME}`, `${workspaceFolder}` | [MCP](https://cursor.com/docs/mcp) | 2026-11-01 |
| GitHub Copilot | VS Code: `.vscode/mcp.json` (`servers`, forwarded to Copilot harness sessions unless it uses `${input:}`); CLI: `.mcp.json`, `.github/mcp.json` (trusted folders); cloud agent: repository settings on github.com | `~/.copilot/mcp-config.json` | VS Code: `type: stdio, http, sse`, `${env:NAME}`, `${input:id}`; CLI: `type: local, stdio, http, sse`, `tools`, `$VAR`, `${VAR}`, `${VAR:-default}` | [VS Code](https://code.visualstudio.com/docs/copilot/reference/mcp-configuration), [CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers) | 2026-11-01 |
| Gemini CLI | `mcpServers` in `.gemini/settings.json` | `~/.gemini/settings.json` | `command`, or `url` (SSE), or `httpUrl` (streamable HTTP); `$VAR`, `${VAR}`; `trust`, `includeTools`, `excludeTools` | [MCP](https://geminicli.com/docs/tools/mcp-server/) | 2026-11-01 |
| OpenCode | `mcp` in `opencode.json` | `~/.config/opencode/opencode.json` | `type: local` with `command` as an array, `environment`; `type: remote` with `url`; `{env:VAR}`, `{file:path}` | [MCP](https://opencode.ai/docs/mcp-servers/) | 2026-11-01 |
| Windsurf (Devin Desktop) | Devin `.devin/mcp_config.json` | `~/.codeium/windsurf/mcp_config.json` (legacy) | `serverUrl` or `url`; `${env:VAR}` | [MCP](https://docs.windsurf.com/pt-BR/windsurf/cascade/mcp.md) | 2026-11-01 |
| Cline | None | `cline_mcp_settings.json` | `autoApprove`, `type: streamableHttp` | [MCP](https://docs.cline.bot/mcp/mcp-overview.md) | 2026-11-01 |
| Roo Code | `.roo/mcp.json` | `mcp_settings.json` | `type: streamable-http, sse`; `${env:VAR}` | [MCP](https://roocodeinc.github.io/Roo-Code/features/mcp/using-mcp-in-roo) | 2026-11-01 |
| Kilo Code | `mcp` in `kilo.json` / `kilo.jsonc` | `~/.config/kilo/kilo.jsonc` | OpenCode shape; `{env:VAR}` | [MCP](https://kilo.ai/docs/automate/mcp/using-in-cli) | 2026-11-01 |
| Amp | `amp.mcpServers` in `.amp/settings.json` (run `amp mcp approve`) | `~/.config/amp/settings.json` | `command`, `args`, `env`; `url`, `headers`; `${VAR}` | [MCP](https://ampcode.com/docs/customize/mcp) | 2026-11-01 |
| Aider | Not supported | | | [options](https://aider.chat/docs/config/options.html) | 2026-11-01 |
| Zed | `context_servers` in `.zed/settings.json`, trusted worktrees | `~/.config/zed/settings.json` | `command`, `args`, `env`; `url`, `headers`; variable references not documented | [MCP](https://zed.dev/docs/ai/mcp.md) | 2026-11-01 |
| JetBrains Junie | `.junie/mcp/mcp.json` | `~/.junie/mcp/mcp.json` | `mcpServers`; no variable references | [MCP](https://junie.jetbrains.com/docs/junie-cli-mcp-configuration.html) | 2026-11-01 |
| Kiro | `.kiro/settings/mcp.json` | `~/.kiro/settings/mcp.json` | `mcpServers`, `disabled`, `autoApprove`; `${VAR}` for approved variables only | [MCP](https://kiro.dev/docs/mcp/configuration/) | 2026-11-01 |
| Goose | Not documented | `extensions:` in `~/.config/goose/config.yaml` | `type: stdio, streamable_http` | [config](https://goose-docs.ai/docs/guides/config-files/) | 2026-11-01 |
| Continue | `.continue/mcpServers/*.yaml` or `*.json` | `~/.continue/mcpServers` | IDE extensions, agent mode only | [MCP](https://docs.continue.dev/customize/deep-dives/mcp) | 2026-11-01 |
| Augment Code | `mcpServers` in `.augment/settings.json` | `~/.augment/settings.json` | `type: stdio, http, sse`; `${VAR}`, `${VAR:-default}` | [MCP](https://docs.augmentcode.com/cli/integrations.md) | 2026-11-01 |
| Qwen Code | `mcpServers` in `.qwen/settings.json`; project `.mcp.json` (both need approval) | `~/.qwen/settings.json` | Gemini CLI shape; `$VAR`, `${VAR}` | [MCP](https://qwenlm.github.io/qwen-code-docs/en/users/features/mcp/) | 2026-11-01 |
| Factory Droid | `.factory/mcp.json` | `~/.factory/mcp.json` | `type: stdio, http, sse`; `${NAME}` in `env` and `headers` only | [MCP](https://docs.factory.com/harness/mcp.md) | 2026-11-01 |
| Trae | `.trae/mcp.json` (switch "Enable Project MCP") | App UI | Only `${workspaceFolder}` | [MCP](https://docs.trae.ai/ide/add-mcp-servers) | 2026-11-01 |
| Warp | `.warp/.mcp.json`; also reads `.mcp.json`, `.codex/config.toml`, `.agents/.mcp.json` | `~/.warp/.mcp.json` | Approval per session; variable references not documented | [MCP](https://docs.warp.dev/agents/capabilities/mcp/) | 2026-11-01 |

## Permission policies

**Sigil:** a policy capability is `policy.json` with `deny` and `ask` lists of `read` globs and `shell`
command prefixes. There is no `allow` list: a third-party capability can make an agent more careful,
never less. Agents that cannot express a rule exactly (Cursor matches only the command name) are
refused rather than given a broader rule.

| Agent | Project file | What it can express | Source | Checked |
| --- | --- | --- | --- | --- |
| Claude Code | `permissions` in `.claude/settings.json` (`allow`, `ask`, `deny`, `defaultMode`); `sandbox` | `Bash(npm run *)`, `Read(./.env)`; deny and ask apply before folder trust | [permissions](https://code.claude.com/docs/en/permissions) | 2026-11-01 |
| OpenAI Codex | `.codex/rules/*.rules` (Starlark `prefix_rule`), `sandbox_mode`, `approval_policy` in `.codex/config.toml` (trusted) | Command prefixes: `allow`, `prompt`, `forbidden` | [rules](https://learn.chatgpt.com/docs/agent-configuration/rules) | 2026-11-01 |
| Cursor | `.cursor/cli.json` (CLI) | `Shell(name)`, `Read(glob)`, `Write(glob)`; allow and deny | [permissions](https://cursor.com/docs/cli/reference/permissions) | 2026-11-01 |
| OpenCode | `permission` in `opencode.json` | `bash` patterns, `edit`, `webfetch`...: `allow`, `ask`, `deny`; last match wins | [permissions](https://opencode.ai/docs/permissions/) | 2026-11-01 |
| Gemini CLI | Workspace policies (`.gemini/policies/`) are documented as non-functional | User and admin `policies/*.toml` only | [policy engine](https://geminicli.com/docs/reference/policy-engine/) | 2026-11-01 |
| GitHub Copilot | None: the CLI ignores permission keys in repository settings | User-level `~/.copilot/permissions-config.json` | [config reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference) | 2026-11-01 |

## Plugin and extension packs

**Sigil:** a `plugin` payload is one agent's native pack. It is installed only into that agent, and only
where the agent documents a project-level install made of plain files. Today that is Claude Code: a
plugin directory under `.claude/skills/` loads once the project is trusted.

| Agent | Pack manifest | Project-level install as files | Source | Checked |
| --- | --- | --- | --- | --- |
| Claude Code | `.claude-plugin/plugin.json` (`name` required); marketplaces in `.claude-plugin/marketplace.json` | Yes: a plugin folder under `.claude/skills/`, or `enabledPlugins` + `extraKnownMarketplaces` in `.claude/settings.json`; after folder trust | [plugins](https://code.claude.com/docs/en/plugins-reference), [loading](https://code.claude.com/docs/en/plugins/loading) | 2026-11-01 |
| Gemini CLI | `gemini-extension.json` | No: extensions load from `~/.gemini/extensions` | [extensions](https://geminicli.com/docs/extensions/reference/) | 2026-11-01 |
| OpenAI Codex | Root `plugin.json` (Agent Plugins schema) or `.codex-plugin/plugin.json` | Partial: a repo marketplace (`.agents/plugins/marketplace.json`) only makes plugins discoverable | [plugins](https://developers.openai.com/codex/plugins/build) | 2026-11-01 |
| Cursor | `.cursor-plugin/plugin.json` or root `plugin.json` | Not documented (installed from the UI) | [plugins](https://cursor.com/docs/plugins) | 2026-11-01 |
| GitHub Copilot | Root `plugin.json`; also `.claude-plugin/plugin.json` | Yes, through a marketplace in `.github/copilot/settings.json` (not generated by Sigil yet) | [config reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference), [VS Code](https://code.visualstudio.com/docs/copilot/customization/agent-plugins) | 2026-11-01 |
| Qwen Code | `qwen-extension.json` (converts Gemini and Claude packs) | No: `~/.qwen/extensions` | [extensions](https://qwenlm.github.io/qwen-code-docs/en/users/extension/introduction/) | 2026-11-01 |
| OpenCode | npm package names in `plugin`, or files in `.opencode/plugins/` | Yes, but plugins are code, not packs of agent files | [plugins](https://opencode.ai/docs/plugins/) | 2026-11-01 |
| Goose | `plugin.json`, `.plugin/plugin.json` or `.goose-plugin/plugin.json` | Yes: `.agents/plugins/<name>/`, in Goose's own format | [plugins](https://goose-docs.ai/docs/guides/context-engineering/plugins) | 2026-11-01 |

## Corrections

Docs move. If a row is wrong or out of date, open an issue with the official link and the date you
checked. Mappings change only with a source.
