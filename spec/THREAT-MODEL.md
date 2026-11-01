# Threat model

Sigil sits between capability authors and the agents that run their content with a developer's
privileges. This document lists what we defend against, how, and where the defences stop.

## Assets

- **The developer's machine and credentials**: what an installed capability can reach through the agent.
- **The integrity of the catalog**: that what is installed is what was reviewed and measured.
- **The integrity of evidence**: that published results came from real runs of the sealed content.
- **The lab operator's credentials**: the model provider token used to run evaluations.

## Adversaries

| Adversary | Goal |
| --- | --- |
| Malicious author | Get harmful instructions or scripts installed while looking legitimate. |
| Compromised upstream | Change a third-party capability after it was evaluated. |
| Network attacker / compromised mirror | Serve different bytes at install time. |
| Gamer | Make a capability look effective (overfit tasks, tamper with tests, cherry-pick runs). |
| Malicious run | A capability under test tries to escape the sandbox or steal the operator's token. |

## Threats and controls

| Threat | Control | Residual risk |
| --- | --- | --- |
| Plain-language malicious instructions | Canary sandbox (honeytokens, egress proxy, write and persistence tripwires) plus human review | Instructions that only trigger in specific environments may not fire in the sandbox. |
| Obfuscated or hidden payloads | `sigil scan`: encoded blobs, invisible Unicode, remote fetch and execute, risky bundled files | Novel encodings; mitigated by review and by rejecting binaries and packed code. |
| Permission understatement | Scan compares used hosts, commands and env vars with the manifest | Dynamic construction of hosts or commands at runtime. |
| Content swapped after review | Verification bound to the payload digest; external sources pinned to a full commit SHA | None for installs through `sigil add`, which recomputes the digest. |
| Tampered download | Per-file sha256 and digest recomputed before writing anything | — |
| Install-time code execution | `sigil add` never runs scripts, hooks or package installs | Hooks run later by design; their exact commands are shown before install. |
| Overfit or unfair tasks | Public tasks with fairness rules, validity checks, hidden verifiers, community challenges | Small suites; results are scoped to the suite and say so. |
| Test tampering by the agent | Protected files hashed before and after; tampered runs count as failures | — |
| Cherry-picked runs | All runs for a digest are kept; verdicts come from intervals with a minimum run count | An operator could discard raw runs locally; CI-produced evidence is attested. |
| Sandbox escape or token theft during runs | Non-root containers, no host mounts beyond the work dir, internal network, logging proxy, token passed as env and redacted from traces | Container runtime vulnerabilities. Third-party capabilities never run on the host. |
| Forged evidence | Evidence produced in CI carries GitHub artifact attestations | Locally produced evidence is labelled as such. |

## Out of scope

- Vulnerabilities in the agents themselves (report them to their vendors).
- Risks from capabilities installed outside Sigil.
- A developer granting an installed capability more access than it declared.
