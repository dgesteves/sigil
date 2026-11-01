'use strict'

const assert = require('node:assert/strict')
const { after, before, test } = require('node:test')
const { createApp } = require('../src/app')

let server
let base

before(async () => {
  server = createApp().listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  base = `http://127.0.0.1:${server.address().port}`
})

after(() => new Promise((resolve) => server.close(resolve)))

test('health', async () => {
  const res = await fetch(`${base}/api/health`)
  assert.equal(res.status, 200)
})

test('lists books with default paging', async () => {
  const res = await fetch(`${base}/api/books`)
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.page, 1)
  assert.equal(body.limit, 20)
  assert.equal(body.total, 12)
  assert.equal(body.items.length, 12)
})

test('gets a book', async () => {
  const res = await fetch(`${base}/api/books/b3`)
  assert.equal(res.status, 200)
  assert.equal((await res.json()).title, 'Dune')
})

test('signs up a user from the app', async () => {
  const res = await fetch(`${base}/api/users`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Ana', email: 'ana@example.com' }),
  })
  const user = await res.json()
  assert.equal(user.name, 'Ana')
  assert.match(user.id, /^u\d+$/)
})

test('serves docs', async () => {
  const res = await fetch(`${base}/docs/getting-started.md`)
  assert.equal(res.status, 200)
  assert.match(await res.text(), /# Getting started/)
})
