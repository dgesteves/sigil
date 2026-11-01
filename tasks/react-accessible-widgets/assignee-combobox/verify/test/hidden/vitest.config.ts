import { defineConfig } from 'vitest/config'

// Run from the repo root: ./node_modules/.bin/vitest run --config test/hidden/vitest.config.ts
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['test/hidden/**/*.test.tsx'],
    setupFiles: ['test/hidden/setup.ts'],
    testTimeout: 20_000,
  },
})
