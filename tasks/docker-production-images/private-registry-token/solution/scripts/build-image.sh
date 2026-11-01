#!/usr/bin/env bash
# Builds the multi-arch ledger-worker image. CI runs this with PUSH=1; locally it only builds.
#   NPM_TOKEN  GitHub token with read:packages, for the @northwind/* packages (required)
#   IMAGE      image name (default ghcr.io/northwind-labs/ledger-worker)
#   TAG        image tag (default: short commit SHA)
#   PUSH       set to 1 to push the image, its attestations and the build cache
set -euo pipefail

cd "$(dirname "$0")/.."

: "${NPM_TOKEN:?export NPM_TOKEN (a GitHub token with read:packages) first}"
IMAGE="${IMAGE:-ghcr.io/northwind-labs/ledger-worker}"
TAG="${TAG:-$(git rev-parse --short HEAD)}"

output="--load"
if [ "${PUSH:-}" = "1" ]; then
  output="--push"
fi

docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --secret id=npm_token,env=NPM_TOKEN \
  --provenance=mode=max \
  --sbom=true \
  --cache-from "type=registry,ref=${IMAGE}:buildcache" \
  --cache-to "type=registry,ref=${IMAGE}:buildcache,mode=max" \
  --tag "${IMAGE}:${TAG}" \
  "$output" \
  .
