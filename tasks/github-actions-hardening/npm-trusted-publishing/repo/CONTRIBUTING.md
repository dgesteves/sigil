# Contributing to unitwise

## Development

```sh
npm ci
npm test
```

We support every Node.js release line that is still maintained (see `engines` in package.json), and CI
tests all of them.

## GitHub Actions conventions

- Every action is pinned to a full-length commit SHA, with the release it corresponds to in a trailing
  comment (`uses: owner/action@<sha> # vX.Y.Z`). Never reference a tag or branch. Dependabot keeps the
  pins current.
- Workflows declare `permissions` explicitly and grant each job only what it needs.

## Releasing

1. `npm version minor` (or `patch`/`major`) on an up-to-date `main`. This commits the bump and creates
   the `vX.Y.Z` tag.
2. `git push --follow-tags`.
