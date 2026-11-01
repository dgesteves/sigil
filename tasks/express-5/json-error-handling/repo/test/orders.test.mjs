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

const post = (path, body) =>
  fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

test('lists orders', async () => {
  const res = await fetch(`${base}/api/orders`)
  assert.equal(res.status, 200)
  assert.equal((await res.json()).orders.length >= 3, true)
})

test('gets one order', async () => {
  const res = await fetch(`${base}/api/orders/1001`)
  assert.equal(res.status, 200)
  assert.equal((await res.json()).sku, 'HP-200')
})

test('creates an order', async () => {
  const res = await post('/api/orders', { sku: 'SPK-10', quantity: 2 })
  assert.equal(res.status, 201)
  const order = await res.json()
  assert.equal(order.sku, 'SPK-10')
  assert.equal(order.quantity, 2)
  assert.equal(order.status, 'pending')
})

test('cancels a pending order', async () => {
  const res = await post('/api/orders/1002/cancel')
  assert.equal(res.status, 200)
  assert.equal((await res.json()).status, 'cancelled')
})
