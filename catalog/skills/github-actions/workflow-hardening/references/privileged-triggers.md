# Privileged triggers: pull_request_target, workflow_run, issue_comment

These events run in the **base** repository's context: a token that can write (unless restricted),
repository and organization secrets, OIDC, the default branch's cache scope and the runner. They fire
for pull requests and comments from anyone. The workflow file itself always comes from the default
branch (for `pull_request_target`, since 2025-12-08), which is what makes them safe to use, as long as
nothing in the run executes or interprets PR-controlled content.

## Status as of 2026-11-01

- `actions/checkout` v7 refuses fork PR head/merge checkouts for `pull_request_target` and for
  `workflow_run` when `workflow_run.event` is a `pull_request*` event. It blocks when the PR comes from
  a fork and `repository:` is the fork, or `ref:` is `refs/pull/<n>/head|merge`, or `ref:` resolves to
  the PR's head or merge SHA. Same-repo PRs and the `pull_request` event are unaffected.
- The protection was backported to v2.8.0, v3.7.0, v4.4.0, v5.1.0 and v6.1.0 (not v1). Floating tags
  like `@v4` picked it up; SHA pins to earlier releases did not.
- The opt-out `allow-unsafe-pr-checkout: true` only lifts the checkout check. It does nothing about
  `git fetch`, `gh pr checkout` or downloaded artifacts, which were never blocked.
- Default event policy: `pull_request_target` is blocked in public repositories without an explicit
  Actions event policy. Evaluate mode now, enforced on 2026-12-02 for repositories that were on the
  default policy. Private and internal repositories are not affected. A repository that still needs
  the trigger needs an event policy (Settings > Actions > Policies) allowing it, ideally scoped to the
  specific workflow files.

## Pattern A: metadata-only automation on fork PRs

Labels, area tags, reviewer assignment, status checks. Everything needed is in the payload or the
API. Nothing from the fork is checked out.

```yaml
on:
  pull_request_target:
    types: [opened, synchronize]

permissions: {}

jobs:
  areas:
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
    steps:
      - uses: actions/github-script@3a2844b7e9c422d3c10d287c895573f7108da1b3 # v9.0.0
        with:
          script: |
            const pr = context.payload.pull_request
            const files = await github.paginate(github.rest.pulls.listFiles, {
              ...context.repo, pull_number: pr.number, per_page: 100,
            })
            const labels = []
            if (files.some((f) => f.filename.startsWith('docs/'))) labels.push('area/docs')
            if (files.some((f) => f.filename.startsWith('.github/'))) labels.push('area/ci')
            if (labels.length) {
              await github.rest.issues.addLabels({ ...context.repo, issue_number: pr.number, labels })
            }
```

If the job needs the repo's own scripts, check out without `ref:` (default branch) and run those.
Changed file paths come from the API, not from a fork working copy:

```bash
gh pr diff "$PR" --name-only      # or: gh api "repos/$GH_REPO/pulls/$PR/files" --paginate --jq '.[].filename'
```

`actions/labeler` is designed for this trigger: it reads its config from the base branch.

## Pattern B: run PR code, then write back

Split the work so no job has both untrusted code and a credential.

```yaml
# .github/workflows/pr-build.yml: unprivileged
on: pull_request
permissions:
  contents: read
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - run: npm ci && npm test -- --reporter=json > report.json
      - run: echo "${{ github.event.pull_request.number }}" > pr-number   # a number is safe to inline
      - uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2
        with:
          name: report
          path: |
            report.json
            pr-number
```

```yaml
# .github/workflows/pr-report.yml: privileged, never executes the artifact
on:
  workflow_run:
    workflows: [PR build]
    types: [completed]
permissions: {}
jobs:
  comment:
    if: github.event.workflow_run.event == 'pull_request'
    runs-on: ubuntu-latest
    permissions:
      actions: read          # download the other run's artifact
      pull-requests: write
    steps:
      - uses: actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333 # v8.0.2
        with:
          name: report
          path: ${{ runner.temp }}/report   # outside the workspace
          run-id: ${{ github.event.workflow_run.id }}
          github-token: ${{ github.token }}
      - uses: actions/github-script@3a2844b7e9c422d3c10d287c895573f7108da1b3 # v9.0.0
        env:
          DIR: ${{ runner.temp }}/report
        with:
          script: |
            const fs = require('node:fs')
            const raw = fs.readFileSync(`${process.env.DIR}/pr-number`, 'utf8').trim()
            if (!/^\d{1,7}$/.test(raw)) throw new Error('bad PR number in artifact')
            const report = JSON.parse(fs.readFileSync(`${process.env.DIR}/report.json`, 'utf8'))
            const passed = Number(report.passed) || 0
            await github.rest.issues.createComment({
              ...context.repo, issue_number: Number(raw), body: `Tests passed: ${passed}`,
            })
```

Treat everything in the artifact as hostile: validate numbers, never `source`, `eval`, `npm install`
or `unzip` it into the workspace, and never interpolate it into `run:`.

## issue_comment commands

`issue_comment` fires for comments on issues and PRs from anyone. Before acting on `/deploy` or
`/rebase`:

```yaml
if: >-
  github.event.issue.pull_request &&
  startsWith(github.event.comment.body, '/benchmark') &&
  contains(fromJSON('["OWNER","MEMBER","COLLABORATOR"]'), github.event.comment.author_association)
```

Even then, the PR head can change between the comment and your fetch (TOCTOU). If you must run PR
code, pin to the head SHA the maintainer approved and run it in an unprivileged job. The checkout v7
block does not cover `issue_comment`.

## Diagnosing "refusing to check out fork pull request code"

1. Find the checkout with `ref:` or `repository:` pointing at the PR.
2. Ask what the job does with those files. If it runs them in any way, removing the PR checkout is the
   fix. If it only needs metadata, read the payload. If it truly needs to read the diff as data,
   use the API.
3. Keep the trigger and the permissions, re-test behaviour for a fork PR, and leave a comment in the
   workflow explaining why there is no `ref:`.
