import { existsSync, readFileSync } from 'node:fs'
import { expect, test } from 'vitest'

// The request: port to the Svelte 5 API, without the legacy class-component shims.
test('embed.ts no longer uses the Svelte 4 class component API', () => {
  const source = readFileSync('src/embed.ts', 'utf8')
  expect(source).not.toMatch(/svelte\/legacy/)
  expect(source).not.toMatch(/\.\$(on|set|destroy)\s*\(/)
  expect(source).not.toMatch(/new\s+FeedbackWidget\b/)
})

test('the componentApi compatibility option is not enabled', () => {
  for (const file of ['svelte.config.js', 'vite.config.ts', 'vite.config.js']) {
    if (existsSync(file)) expect(readFileSync(file, 'utf8')).not.toMatch(/componentApi/)
  }
})
