# ledger-worker

Posts balanced journal entries to the Northwind ledger. Self-hosting customers run the public image
`ghcr.io/northwind-labs/ledger-worker`; we publish it from CI on every push to `main` and on version
tags.

## Development

```sh
export NPM_TOKEN=...   # GitHub token with read:packages, for @northwind/* on GitHub Packages
npm ci
npm test
PORT=8080 npm start
```

`.npmrc` points the `@northwind` scope at GitHub Packages and reads the token from `NPM_TOKEN`.

## Image

```sh
export NPM_TOKEN=...
./scripts/build-image.sh          # builds both platforms locally
PUSH=1 ./scripts/build-image.sh   # what CI runs (.github/workflows/image.yml)
```

Each published image carries max-mode provenance and an SBOM, and the build cache is pushed to
`ghcr.io/northwind-labs/ledger-worker:buildcache` (`mode=max`) so CI builds stay fast. Both the
image and the cache are public.

The service listens on `PORT` (default 8080) and answers `GET /healthz`.
