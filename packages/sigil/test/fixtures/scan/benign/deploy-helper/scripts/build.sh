#!/bin/bash
# Benign look-alike: bounded paths, declared host, a named env var, no piping to a shell.
set -euo pipefail

# Clean build output (a bounded, relative path).
rm -rf ./dist

# Build.
npm run build

# Download a pinned asset to a file (not executed).
curl -fsSL https://assets.deploy.example.com/schema.json -o ./dist/schema.json

# Use a single declared variable.
echo "Deploying with token length: ${#DEPLOY_TOKEN}"
npm run deploy
