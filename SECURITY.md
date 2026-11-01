# Security

Sigil distributes content that AI agents act on, so security reports get priority over everything else.

## Reporting

**Do not open a public issue for a vulnerability or a malicious capability.** Report it privately
through [GitHub security advisories](https://github.com/dgesteves/sigil/security/advisories/new).

Report there if you find:

- a capability in the catalog that behaves maliciously or deceptively, or whose permissions understate
  what it does;
- a way to make `sigil add` install content that differs from the sealed digest;
- a way for a run in the lab to escape the sandbox, reach the network directly, or read the operator's
  credentials;
- a bypass of `sigil scan` that you can demonstrate with a defanged sample;
- anything that lets evidence for one digest apply to another.

You will get an acknowledgement within 72 hours. Please give us 30 days before public disclosure, or
less by agreement once a fix ships.

## What happens to a malicious capability

1. Its verification is revoked immediately. Revocation is public and includes the reason.
2. `sigil add` refuses to install it, and `sigil list` flags existing installs.
3. The content stays in the history for analysis. It is never silently deleted.
4. A security advisory is published, with credit to the reporter if they want it.

## Scope and limits

`sigil scan` and the canary sandbox lower risk; they do not prove that a capability is safe. Read what
you install. See [spec/METHODOLOGY.md](spec/METHODOLOGY.md#security-checks) and
[spec/THREAT-MODEL.md](spec/THREAT-MODEL.md).

## Supported versions

Security fixes land in the latest minor release of the `sigil` package.
