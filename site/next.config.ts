import { fileURLToPath } from 'node:url'
import type { NextConfig } from 'next'

const root = fileURLToPath(new URL('..', import.meta.url))

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  turbopack: { root },
  outputFileTracingRoot: root,
  // The repo's AGENTS.md is the one contract for agents; don't generate a second one here.
  agentRules: false,
  devIndicators: false,
  async rewrites() {
    return [{ source: '/c/:namespace/:slug.md', destination: '/c/:namespace/:slug/md' }]
  },
}

export default config
