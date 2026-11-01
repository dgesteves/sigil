import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { loadConfig } from '../../src/config.ts'

const DATABASE_URL = 'postgres://billing:s3cret-pw@db.internal:5432/billing'
const base = { DATABASE_URL }

function load(env: Record<string, string | undefined>) {
  return loadConfig(env)
}

function rejects(env: Record<string, string | undefined>, variable: string) {
  assert.throws(
    () => load(env),
    (err: unknown) => {
      assert.ok(err instanceof Error, 'loadConfig must throw an Error')
      assert.match(err.message, new RegExp(variable), `the error message must name ${variable}`)
      return true
    },
  )
}

describe('defaults', () => {
  test('only DATABASE_URL set', () => {
    const c = load({ ...base })
    assert.equal(c.port, 3000)
    assert.equal(c.databaseUrl, DATABASE_URL)
    assert.equal(c.logLevel, 'info')
    assert.equal(c.enableMetrics, false)
    assert.deepEqual([...c.allowedOrigins], [])
    assert.equal(c.requestTimeoutMs, 5000)
  })

  test('empty strings count as unset', () => {
    const c = load({
      ...base,
      PORT: '',
      LOG_LEVEL: '',
      ENABLE_METRICS: '',
      ALLOWED_ORIGINS: '',
      REQUEST_TIMEOUT_MS: '',
    })
    assert.equal(c.port, 3000)
    assert.equal(c.logLevel, 'info')
    assert.equal(c.enableMetrics, false)
    assert.deepEqual([...c.allowedOrigins], [])
    assert.equal(c.requestTimeoutMs, 5000)
  })

  test('unrelated variables are ignored', () => {
    const c = load({ ...base, HOME: '/root', PATH: '/usr/bin', NODE_ENV: 'production', npm_lifecycle_event: 'start' })
    assert.equal(c.port, 3000)
  })
})

describe('PORT', () => {
  test('parses a valid port', () => {
    assert.equal(load({ ...base, PORT: '8080' }).port, 8080)
    assert.equal(load({ ...base, PORT: '1' }).port, 1)
    assert.equal(load({ ...base, PORT: '65535' }).port, 65535)
  })
  for (const PORT of ['0', '65536', '80.5', 'abc', '-1', '8080abc']) {
    test(`rejects ${JSON.stringify(PORT)}`, () => rejects({ ...base, PORT }, 'PORT'))
  }
})

describe('DATABASE_URL', () => {
  test('is required', () => {
    rejects({}, 'DATABASE_URL')
    rejects({ DATABASE_URL: '' }, 'DATABASE_URL')
  })
  test('accepts postgres:// and postgresql://', () => {
    assert.equal(load({ DATABASE_URL: 'postgresql://localhost/billing' }).databaseUrl, 'postgresql://localhost/billing')
  })
  for (const url of ['mysql://billing:pw@db/billing', 'not a url', 'https://db.internal/billing']) {
    test(`rejects ${url}`, () => rejects({ DATABASE_URL: url }, 'DATABASE_URL'))
  }
  test('does not echo the credentials in the error', () => {
    assert.throws(
      () => load({ DATABASE_URL: 'mysql://billing:hunter2-secret@db/billing' }),
      (err: unknown) => {
        assert.ok(err instanceof Error)
        assert.doesNotMatch(err.message, /hunter2-secret/)
        return true
      },
    )
  })
})

describe('LOG_LEVEL', () => {
  test('accepts every level', () => {
    for (const level of ['debug', 'info', 'warn', 'error']) {
      assert.equal(load({ ...base, LOG_LEVEL: level }).logLevel, level)
    }
  })
  test('rejects unknown levels', () => rejects({ ...base, LOG_LEVEL: 'verbose' }, 'LOG_LEVEL'))
})

describe('ENABLE_METRICS', () => {
  for (const value of ['false', 'FALSE', 'False', '0', 'no', 'NO']) {
    test(`${JSON.stringify(value)} is false`, () => {
      assert.equal(load({ ...base, ENABLE_METRICS: value }).enableMetrics, false)
    })
  }
  for (const value of ['true', 'TRUE', 'True', '1', 'yes', 'Yes']) {
    test(`${JSON.stringify(value)} is true`, () => {
      assert.equal(load({ ...base, ENABLE_METRICS: value }).enableMetrics, true)
    })
  }
  for (const value of ['maybe', '2', 'flase']) {
    test(`rejects ${JSON.stringify(value)}`, () => rejects({ ...base, ENABLE_METRICS: value }, 'ENABLE_METRICS'))
  }
})

describe('ALLOWED_ORIGINS', () => {
  test('splits a comma-separated list and trims spaces', () => {
    const c = load({ ...base, ALLOWED_ORIGINS: 'https://app.example.com, https://admin.example.com' })
    assert.deepEqual([...c.allowedOrigins], ['https://app.example.com', 'https://admin.example.com'])
  })
  for (const origins of ['http://app.example.com', 'https://app.example.com,javascript:alert(1)', 'app.example.com']) {
    test(`rejects ${JSON.stringify(origins)}`, () => rejects({ ...base, ALLOWED_ORIGINS: origins }, 'ALLOWED_ORIGINS'))
  }
})

describe('REQUEST_TIMEOUT_MS', () => {
  test('parses a positive integer', () => {
    assert.equal(load({ ...base, REQUEST_TIMEOUT_MS: '2500' }).requestTimeoutMs, 2500)
  })
  for (const value of ['0', '-5', '1.5', 'abc']) {
    test(`rejects ${JSON.stringify(value)}`, () => rejects({ ...base, REQUEST_TIMEOUT_MS: value }, 'REQUEST_TIMEOUT_MS'))
  }
})

test('names every invalid variable in one error', () => {
  assert.throws(
    () => load({ PORT: 'abc', ENABLE_METRICS: 'maybe', LOG_LEVEL: 'loud' }),
    (err: unknown) => {
      assert.ok(err instanceof Error)
      for (const name of ['PORT', 'ENABLE_METRICS', 'LOG_LEVEL', 'DATABASE_URL']) {
        assert.match(err.message, new RegExp(name), `the error message must name ${name}`)
      }
      return true
    },
  )
})
