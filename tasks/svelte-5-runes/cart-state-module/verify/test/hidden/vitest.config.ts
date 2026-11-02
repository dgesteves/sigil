import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vitest/config'

// Run from the repo root: ./node_modules/.bin/vitest run --config test/hidden/vitest.config.ts
export default defineConfig({
  plugins: [svelte()],
  resolve: { conditions: ['browser', 'development'] },
  test: {
    environment: 'jsdom',
    include: ['test/hidden/**/*.test.ts'],
    testTimeout: 20_000,
  },
})
