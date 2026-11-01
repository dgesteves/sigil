import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createApp } from '../src/app.mjs'

let server
let base

before(async () => {
  server = createApp().listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  base = `http://127.0.0.1:${server.address().port}`
})

after(() => new Promise((resolve) => server.close(resolve)))

test('GET /api/health', async () => {
  const res = await fetch(`${base}/api/health`)
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { ok: true })
})

test('GET /api/products lists the catalog', async () => {
  const res = await fetch(`${base}/api/products`)
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.products.length, 6)
})

test('unknown routes return a JSON 404', async () => {
  const res = await fetch(`${base}/api/nope`)
  assert.equal(res.status, 404)
  assert.deepEqual(await res.json(), { error: 'not_found' })
})
