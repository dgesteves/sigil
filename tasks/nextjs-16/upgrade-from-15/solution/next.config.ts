import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [{ protocol: 'https', hostname: 'images.fieldnotes.dev' }],
    // Next 16 only allows quality 75 by default; the hero photo uses 90.
    qualities: [75, 90],
  },
}

export default nextConfig
