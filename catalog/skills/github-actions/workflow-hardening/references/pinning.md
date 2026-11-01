# Pinning actions

## Resolve a tag to the commit it points at

```bash
# All tags; annotated tags show the tag object on one line and the commit on the "^{}" line.
git ls-remote --tags https://github.com/actions/setup-node 'v7.1.0*'

# Or through the API (returns the commit even for annotated tags):
gh api repos/actions/setup-node/commits/v7.1.0 --jq .sha
```

Use the commit SHA (the `^{}` line when present), never the tag object's SHA. Write the exact version
in a comment so Dependabot and reviewers can follow it:

```yaml
- uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
```

Never type a SHA from memory or copy one from a blog post. A SHA from a fork of the action is served
under the upstream name (GitHub shares objects across a fork network), so check that the commit is
reachable from a tag in the upstream repository; `zizmor` reports these as impostor commits.

If you cannot reach the network, reuse a pin that already exists elsewhere in the repository for the
same action, or leave the tag and tell the user which lines still need pinning.

## Current releases (resolved 2026-11-01)

| Action | Release | Commit |
| --- | --- | --- |
| actions/checkout | v7.0.1 | `3d3c42e5aac5ba805825da76410c181273ba90b1` |
| actions/setup-node | v7.1.0 | `949feb2413d6458794dcd2491c4babbbce0c15c1` |
| actions/github-script | v9.0.0 | `3a2844b7e9c422d3c10d287c895573f7108da1b3` |
| actions/cache | v6.1.0 | `55cc8345863c7cc4c66a329aec7e433d2d1c52a9` |
| actions/upload-artifact | v7.0.2 | `cf430e030ddbb5b0abf93d22962f4752f3646cd9` |
| actions/download-artifact | v8.0.2 | `9000827ccba6bdab643e8b6fd33ac0654aef8333` |
| actions/attest | v4.2.2 | `1e69f48acb82d1966a394da916b4c1698aa569d6` |
| actions/create-github-app-token | v3.3.0 | `64ab729a6294000f5aa4a4bc0b73d1f32bc45510` |
| aws-actions/configure-aws-credentials | v6.3.0 | `e1253824e5c10ff9df46874f81ed3ec929e19cfd` |
| google-github-actions/auth | v3.0.0 | `7c6bc770dae815cd3e89ee6cdf493a5fab2cc093` |
| azure/login | v3.1.0 | `a641126d1b8aa4d1fa005f4f92df94a3a4c4c906` |

Re-resolve before using these if time has passed; newer patch releases are usually better.

For checkout specifically: only v2.8.0+, v3.7.0+, v4.4.0+, v5.1.0+, v6.1.0+ and v7.0.0+ carry the
fork-PR checkout protection. A SHA pin to v4.2.2 or v6.0.2 is a pin to an unprotected release.

## Keeping pins fresh

```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly
    groups:
      actions:
        patterns: ['*']
```

Dependabot rewrites both the SHA and the `# vX.Y.Z` comment. Dependabot *security alerts* are not
raised for SHA-pinned actions, so version updates are what keeps you patched.

## Enforcement and lockfiles

- Repository, organization and enterprise Actions policies can require full-length SHA pins and block
  specific actions. Workflows that use tags then fail instead of running.
- Workflow dependency lockfiles: `gh extension install github/gh-actions-lock`, then `gh actions-lock`
  writes `.github/workflows/actions.lock`, pinning every action including transitive dependencies.
  Onboarded workflows satisfy the SHA-pinning policy without SHAs in the YAML. Reusable workflows
  called with `jobs.<id>.uses` are covered by their own repository's lockfile, so pin them by SHA.
  Never edit the lockfile by hand. The feature is new; follow the repository's lead on whether to
  use it.
