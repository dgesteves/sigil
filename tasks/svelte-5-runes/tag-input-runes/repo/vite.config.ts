import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [svelte()],
  // Component tests run in jsdom, so resolve Svelte's browser build (and its dev checks).
  resolve: process.env.VITEST ? { conditions: ['browser', 'development'] } : undefined,
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.ts'],
  },
})
