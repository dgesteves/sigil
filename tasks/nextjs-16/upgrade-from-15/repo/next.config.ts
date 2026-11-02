import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  images: {
    domains: ['images.fieldnotes.dev'],
  },
  eslint: {
    // CI runs `npm run lint` separately.
    ignoreDuringBuilds: true,
  },
}

export default nextConfig
