import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { createApp } from '../../src/app.mjs'
import { createOrdersRepo } from '../../src/orders-repo.mjs'

async function start(options) {
  const server = createApp(options).listen(0)
  await new Promise((resolve, reject) => {
    server.once('listening', resolve)
    server.once('error', reject)
  })
  return { server, base: `http://127.0.0.1:${server.address().port}` }
}

const stop = (server) => new Promise((resolve) => (server ? server.close(resolve) : resolve()))

function request(base, path, { method = 'GET', json, body, headers = {} } = {}) {
  const init = { method, headers: { ...headers }, signal: AbortSignal.timeout(5000) }
  if (json !== undefined) {
    init.body = JSON.stringify(json)
    init.headers['content-type'] = 'application/json'
  } else if (body !== undefined) {
    init.body = body
  }
  return fetch(base + path, init)
}

const INTERNAL = /db-primary|10\.0\.3\.7|5432|ECONNREFUSED|not-null|reading 'rows'|orders-repo|node_modules|\.mjs|\bat .+:\d+:\d+/

async function expectError(res, status, code) {
  const statuses = Array.isArray(status) ? status : [status]
  assert.ok(statuses.includes(res.status), `expected status ${statuses.join(' or ')}, got ${res.status}`)
  assert.match(res.headers.get('content-type') ?? '', /^application\/json/, 'error responses are JSON')
  const text = await res.text()
  assert.doesNotMatch(text, INTERNAL, 'error responses must not leak stack traces or internal details')
  const body = JSON.parse(text)
  assert.equal(typeof body?.error?.code, 'string', 'body.error.code is a string')
  assert.equal(typeof body.error.message, 'string', 'body.error.message is a string')
  if (code) assert.equal(body.error.code, code)
  return body
}

describe('with the in-memory repository', () => {
  let server
  let base
  before(async () => ({ server, base } = await start()))
  after(() => stop(server))

  test('unknown routes return a JSON 404', async () => {
    await expectError(await request(base, '/api/unknown'), 404, 'not_found')
    await expectError(await request(base, '/', { method: 'POST' }), 404, 'not_found')
  })

  test('unknown order ids return a JSON 404', async () => {
    await expectError(await request(base, '/api/orders/9999'), 404, 'not_found')
  })

  test('invalid order bodies are rejected with 400 validation_failed', async () => {
    const invalid = [
      {},
      [],
      { sku: 'HP-200' },
      { quantity: 1 },
      { sku: '', quantity: 1 },
      { sku: 42, quantity: 1 },
      { sku: 'HP-200', quantity: 0 },
      { sku: 'HP-200', quantity: 101 },
      { sku: 'HP-200', quantity: 2.5 },
      { sku: 'HP-200', quantity: '3' },
    ]
    for (const json of invalid) {
      const res = await request(base, '/api/orders', { method: 'POST', json })
      await expectError(res, 400, 'validation_failed').catch((e) => {
        e.message = `${JSON.stringify(json)}: ${e.message}`
        throw e
      })
    }
  })

  test('valid orders at the quantity bounds are still created', async () => {
    for (const quantity of [1, 100]) {
      const res = await request(base, '/api/orders', { method: 'POST', json: { sku: 'SPK-10', quantity } })
      assert.equal(res.status, 201)
      assert.equal((await res.json()).quantity, quantity)
    }
  })

  test('a request without a JSON body is a client error, not a crash', async () => {
    await expectError(await request(base, '/api/orders', { method: 'POST' }), [400, 415])
    const plain = await request(base, '/api/orders', {
      method: 'POST',
      body: 'sku=HP-200&quantity=1',
      headers: { 'content-type': 'text/plain' },
    })
    await expectError(plain, [400, 415])
  })

  test('malformed JSON returns a JSON 400', async () => {
    const res = await request(base, '/api/orders', {
      method: 'POST',
      body: '{"sku": "HP-200", quantity: }',
      headers: { 'content-type': 'application/json' },
    })
    await expectError(res, 400)
  })

  test('a body over the 10kb limit returns a JSON 413', async () => {
    const res = await request(base, '/api/orders', {
      method: 'POST',
      json: { sku: 'x'.repeat(20_000), quantity: 1 },
    })
    await expectError(res, 413)
  })

  test('cancelling a shipped order returns 409 conflict', async () => {
    await expectError(await request(base, '/api/orders/1003/cancel', { method: 'POST' }), 409, 'conflict')
  })

  test('cancelling an unknown order returns 404 and the server keeps serving', async () => {
    await expectError(await request(base, '/api/orders/4242/cancel', { method: 'POST' }), 404, 'not_found')
    const health = await request(base, '/api/health')
    assert.equal(health.status, 200)
  })

  test('happy paths still work after errors', async () => {
    const res = await request(base, '/api/orders/1001')
    assert.equal(res.status, 200)
    assert.equal((await res.json()).sku, 'HP-200')
    const cancel = await request(base, '/api/orders/1001/cancel', { method: 'POST' })
    assert.equal(cancel.status, 200)
    assert.equal((await cancel.json()).status, 'cancelled')
  })
})

describe('when the repository fails unexpectedly', () => {
  let server
  let base
  before(async () => {
    const healthy = createOrdersRepo()
    const repo = {
      ...healthy,
      list() {
        // A bug in the data layer that throws synchronously.
        throw new TypeError("Cannot read properties of undefined (reading 'rows')")
      },
      async get() {
        throw new Error('connect ECONNREFUSED 10.0.3.7:5432 (db-primary.internal)')
      },
      async cancel() {
        throw new Error('connect ECONNREFUSED 10.0.3.7:5432 (db-primary.internal)')
      },
    }
    ;({ server, base } = await start({ repo }))
  })
  after(() => stop(server))

  test('a rejected repository call returns a generic 500', async () => {
    await expectError(await request(base, '/api/orders/1001'), 500, 'internal_error')
    await expectError(await request(base, '/api/orders/1001/cancel', { method: 'POST' }), 500, 'internal_error')
  })

  test('a synchronous throw returns a generic 500', async () => {
    await expectError(await request(base, '/api/orders'), 500, 'internal_error')
  })

  test('the server keeps serving after unexpected errors', async () => {
    const res = await request(base, '/api/health')
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { ok: true })
  })
})
