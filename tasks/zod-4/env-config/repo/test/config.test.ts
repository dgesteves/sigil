import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadConfig } from '../src/config.ts'

test('reads a complete production environment', () => {
  const config = loadConfig({
    PORT: '8080',
    DATABASE_URL: 'postgres://billing:pw@db.internal:5432/billing',
    LOG_LEVEL: 'warn',
    ENABLE_METRICS: 'true',
    ALLOWED_ORIGINS: 'https://app.example.com',
    REQUEST_TIMEOUT_MS: '2500',
  })
  assert.equal(config.port, 8080)
  assert.equal(config.databaseUrl, 'postgres://billing:pw@db.internal:5432/billing')
  assert.equal(config.logLevel, 'warn')
  assert.equal(config.enableMetrics, true)
  assert.deepEqual(config.allowedOrigins, ['https://app.example.com'])
  assert.equal(config.requestTimeoutMs, 2500)
})
