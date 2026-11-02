import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

// Run from the repo root: ./node_modules/.bin/vitest run --config test/hidden/vitest.config.ts
export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'jsdom',
    include: ['test/hidden/**/*.hidden.test.ts', 'test/TagInput.test.ts'],
    testTimeout: 20_000,
  },
})
