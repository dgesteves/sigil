# Sources

Checked on 2026-11-01. Release numbers and commit SHAs were resolved with `git ls-remote --tags` and
the GitHub API on the same day.

## GitHub documentation

- Secure use reference: https://docs.github.com/en/actions/reference/security/secure-use
- Script injections: https://docs.github.com/en/actions/concepts/security/script-injections
- Securely using pull_request_target: https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target
- Workflow syntax, `permissions` and `concurrency`: https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax
- Workflow commands (`GITHUB_ENV`, `GITHUB_OUTPUT`, multiline values): https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands
- GITHUB_TOKEN: https://docs.github.com/en/actions/concepts/security/github_token
- Workflow execution policies (event, actor, lockfile, SHA pinning policies; pull_request_target default policy): https://docs.github.com/en/actions/how-tos/administer/control-workflow-execution
- Workflow dependency lockfiles: https://docs.github.com/en/actions/concepts/security/workflow-dependency-lockfiles and https://docs.github.com/en/actions/how-tos/secure-your-work/lock-workflow-dependencies

## GitHub changelog

- Safer pull_request_target defaults for actions/checkout (2026-06-18): https://github.blog/changelog/2026-06-18-safer-pull_request_target-defaults-for-github-actions-checkout/
- pull_request_target and environment branch protection changes (effective 2025-12-08): https://github.blog/changelog/2025-11-07-actions-pull_request_target-and-environment-branch-protections-changes/
- Deprecation of Node 20 on GitHub Actions runners (Node 24 default 2026-06-16, removal scheduled 2026-09-23): https://github.blog/changelog/2025-09-19-deprecation-of-node-20-on-github-actions-runners/

## Action repositories (READMEs, action.yml, release notes)

- https://github.com/actions/checkout (v7 fork-PR protection, `allow-unsafe-pr-checkout`, v6 credential file)
- https://github.com/actions/setup-node (v7 `NODE_AUTH_TOKEN` change, v6 `always-auth` removal, v5 auto caching, trusted publishing example in docs/advanced-usage.md)
- https://github.com/actions/github-script (v9 `getOctokit`, `require('@actions/github')` removal)
- https://github.com/actions/cache (cache service migration, minimum v3.4.0 / v4.2.0)
- https://github.com/actions/upload-artifact and https://github.com/actions/download-artifact (v3 retirement on github.com, cross-run downloads)
- https://github.com/actions/attest (required permissions)
- https://github.com/aws-actions/configure-aws-credentials, https://github.com/google-github-actions/auth, https://github.com/Azure/login (inputs)
- https://github.com/zizmorcore/zizmor (offline mode, impostor commit audit)

## npm

- Trusted publishers: https://docs.npmjs.com/trusted-publishers
- Staged publishing changelog (2026-05): https://github.blog/changelog/2026-05-22-staged-publishing-and-new-install-time-controls-for-npm
- npm CLI versions bundled with the `node:24-bookworm` and `node:22-bookworm` images were read by
  running `npm -v` in those images.
