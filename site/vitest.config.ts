import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const src = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@core/glyph': src('../packages/sigil/src/core/glyph.ts'),
      '@core/ids': src('../packages/sigil/src/core/ids.ts'),
      '@/': src('./src/'),
    },
  },
  test: { include: ['test/**/*.test.ts'], testTimeout: 20_000 },
})
