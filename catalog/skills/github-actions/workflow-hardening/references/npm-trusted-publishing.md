# npm trusted publishing from GitHub Actions

Trusted publishing replaces the `NPM_TOKEN` secret with OIDC: the job proves its identity
(owner/repo, workflow file, optional environment) to npm and gets a short-lived publish token. Nothing
to leak, nothing to rotate.

## Requirements (checked 2026-11-01)

- npm CLI **11.5.1 or later**, Node **22.14.0 or later**. The `node:24` images ship npm 11.x
  (11.19.1 at the time of writing); `node:22` images ship npm 10.9.x, which fails. With Node 22, add
  `npm install -g npm@latest` before publishing, or just use Node 24.
- `permissions: id-token: write` on the publishing job (and on both caller and callee if publishing
  happens in a reusable workflow).
- A GitHub-hosted runner. Self-hosted runners are not supported.
- A trusted publisher configured on npmjs.com for the package: organization or user, repository,
  workflow **file name** (e.g. `release.yml`, file name only, with extension, must exist in
  `.github/workflows/`), optional environment. npm does not validate it on save; mistakes show up at
  publish time. A new configuration expires if it has no successful publish within 2 days.
- `repository.url` in package.json must match the GitHub repository exactly, e.g.
  `"repository": { "type": "git", "url": "git+https://github.com/OWNER/REPO.git" }`. Forks that
  did not update it cannot publish.
- With `workflow_dispatch` or `workflow_call`, npm validates the **calling** workflow's file name.

Provenance is generated automatically for public packages published from public repositories; no
`--provenance` flag needed. Disable it with `NPM_CONFIG_PROVENANCE=false` or
`publishConfig.provenance: false` if you must.

## Workflow

```yaml
name: Release
on:
  push:
    tags: ['v[0-9]+.[0-9]+.[0-9]+']

permissions: {}

concurrency:
  group: release
  cancel-in-progress: false

jobs:
  test:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with:
          node-version: 24
          package-manager-cache: false
      - run: npm ci
      - run: npm test

  publish:
    needs: test
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with:
          node-version: 24
          registry-url: https://registry.npmjs.org
          package-manager-cache: false
      - run: npm ci
      - run: npm publish            # no NODE_AUTH_TOKEN, no --provenance needed

  github-release:
    needs: publish
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - env:
          GH_TOKEN: ${{ github.token }}
          GH_REPO: ${{ github.repository }}
          TAG: ${{ github.ref_name }}
        run: gh release create "$TAG" --verify-tag --generate-notes
```

Notes:

- `package-manager-cache: false`: setup-node v5+ enables npm caching automatically when package.json
  names npm in `packageManager`/`devEngines.packageManager`. A poisoned cache in a publishing job can
  steal the OIDC token. setup-node's and npm's own examples disable it.
- `registry-url` is optional for the public registry; keep it if the project also installs scoped
  private packages with a read-only token.
- Splitting `publish` (OIDC) from `github-release` (`contents: write`) keeps each credential in the
  smallest job.
- If the tag and `version` in package.json can drift, add a check step before publishing.

## Staged publishing (npm CLI 11.15.0+)

`npm stage publish` uploads the tarball to a queue; a maintainer approves it with 2FA
(`npm stage approve`) before it becomes installable. Trusted publisher configurations can allow
`npm publish`, `npm stage publish`, or both:

- configurations created before 2026-05-20 allow `npm publish` only,
- configurations created after 2026-09-03 default to `npm stage publish`, with `npm publish` optional.

Use whichever command the user's configuration allows; ask if unsure. `npm dist-tag` over OIDC needs
the separate "Allow npm dist-tag" option and npm 11.21.0+ or 12.2.0+.

## Lock it down afterwards

Once a trusted publish has succeeded: package Settings > Publishing access > "Require two-factor
authentication and disallow tokens", and revoke the old automation token. Disallowing tokens does not
affect OIDC.

## Failure modes

| Symptom | Likely cause |
| --- | --- |
| `ENEEDAUTH` / "Unable to authenticate" | workflow file name or owner/repo in the npm configuration does not match, self-hosted runner, or npm < 11.5.1 |
| E404 on publish of an existing package | trusted publisher configuration (repo, workflow file, environment) does not match the run's identity |
| E422 "Error verifying sigstore provenance bundle" mentioning `repository.url` | package.json `repository` missing, or still pointing at an old name after a rename or transfer |
| Publishes but no provenance | private repository or private package (expected) |
