# Contributing to tally-api

## Local development

```sh
npm ci
npm run dev        # node --watch with .env and .env.local
npm test
npm run build      # compiles src/ to dist/
```

`.env` and `.env.local` hold local settings and keys. They stay on your machine.

## Container images

Every image a Dockerfile pulls (each `FROM`, and `COPY --from` / `RUN --mount=from=` that name an
image rather than a stage) must be one of the approved images below, pinned by its exact tag **and**
digest:

```dockerfile
FROM node:24.22.2-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c
```

Renovate (`renovate.json`, `docker:pinDigests`) proposes updates to both. To use an image that is not
listed, ask in #platform first.

| Image | Digest | Use |
| --- | --- | --- |
| `node:24.22.2-bookworm` | `sha256:e7add2a490bb17d97b485b8641bd88455fff7839ade0f5eba493c3508124d413` | build stages only |
| `node:24.22.2-trixie` | `sha256:8c761eca2bf7eec965f946cf47b8090143cb41f45f2f8699af0cc0298d2d2d19` | build stages only |
| `node:24.22.2-bookworm-slim` | `sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c` | build or runtime |
| `node:24.22.2-trixie-slim` | `sha256:54f84b4cf8432b21aaffd5d3ce8d41e12cea0d10d33c09d2f3c9879d49d6b446` | build or runtime |
| `node:24.22.2-alpine3.24` | `sha256:8a32c8cf649a49915a66e81e7a609223c708d0adabf288ee3f4077d765542f85` | build or runtime |
| `gcr.io/distroless/nodejs24-debian13:nonroot` | `sha256:b8cec4b2f2126ff7bd034ec9ac207ffb3272667dfdc48376e3b035d3270549ba` | runtime |

The digests are the multi-platform index digests (linux/amd64 and linux/arm64).
