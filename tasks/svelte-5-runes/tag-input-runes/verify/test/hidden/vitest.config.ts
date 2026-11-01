import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vitest/config'

// Run from the repo root: ./node_modules/.bin/vitest run --config test/hidden/vitest.config.ts
// Also runs the repo's own (protected) test file, so one Vite startup covers both.
export default defineConfig({
  plugins: [svelte()],
  resolve: { conditions: ['browser', 'development'] },
  test: {
    environment: 'jsdom',
    include: ['test/hidden/**/*.test.ts', 'test/TagInput.test.ts'],
    testTimeout: 20_000,
  },
})
