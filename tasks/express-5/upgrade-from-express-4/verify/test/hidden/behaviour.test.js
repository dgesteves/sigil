'use strict'

// The API must behave as it did on Express 4. Every assertion here passes against the original
// src/app.js running on express@4.22.3.

const assert = require('node:assert/strict')
const { after, before, describe, test } = require('node:test')
const { createApp } = require('../../src/app')

let server
let base

before(async () => {
  server = createApp().listen(0)
  await new Promise((resolve, reject) => {
    server.once('listening', resolve)
    server.once('error', reject)
  })
  base = `http://127.0.0.1:${server.address().port}`
})

after(() => new Promise((resolve) => (server ? server.close(resolve) : resolve())))

const call = (path, init = {}) =>
  fetch(base + path, { redirect: 'manual', signal: AbortSignal.timeout(5000), ...init })

const postJson = (path, body) =>
  call(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

const ids = (body) => body.items.map((b) => b.id)

describe('GET /api/books', () => {
  test('pages with page and limit', async () => {
    const body = await (await call('/api/books?limit=5&page=2')).json()
    assert.equal(body.page, 2)
    assert.equal(body.limit, 5)
    assert.equal(body.total, 12)
    assert.deepEqual(ids(body), ['b6', 'b7', 'b8', 'b9', 'b10'])
  })

  test('caps limit at 50 and defaults bad values', async () => {
    const capped = await (await call('/api/books?limit=500')).json()
    assert.equal(capped.limit, 50)
    const defaults = await (await call('/api/books?limit=abc&page=zero')).json()
    assert.equal(defaults.limit, 20)
    assert.equal(defaults.page, 1)
    assert.equal(defaults.items.length, 12)
  })

  test('filters with nested filter[...] query parameters', async () => {
    const sf = await (await call('/api/books?filter[genre]=sf')).json()
    assert.equal(sf.total, 6)
    assert.deepEqual(ids(sf), ['b1', 'b3', 'b4', 'b7', 'b9', 'b11'])
    const author = encodeURIComponent('Ursula K. Le Guin')
    const both = await (await call(`/api/books?filter[genre]=sf&filter[author]=${author}`)).json()
    assert.deepEqual(ids(both), ['b1', 'b4'])
  })
})

describe('GET /api/books/:id', () => {
  test('returns the book', async () => {
    const res = await call('/api/books/b5')
    assert.equal(res.status, 200)
    assert.equal((await res.json()).title, 'The Hobbit')
  })

  test('unknown books are a 404', async () => {
    assert.equal((await call('/api/books/b99')).status, 404)
  })
})

describe('GET /api/books/:id/cover[/:size]', () => {
  test('redirects to the medium cover by default', async () => {
    const res = await call('/api/books/b1/cover')
    assert.equal(res.status, 302)
    assert.equal(res.headers.get('location'), 'https://covers.example.com/9780061054884-medium.jpg')
  })

  test('redirects to the requested size', async () => {
    const res = await call('/api/books/b3/cover/large')
    assert.equal(res.status, 302)
    assert.equal(res.headers.get('location'), 'https://covers.example.com/9780441172719-large.jpg')
  })

  test('rejects unknown sizes with 400', async () => {
    const res = await call('/api/books/b3/cover/huge')
    assert.equal(res.status, 400)
    assert.deepEqual(await res.json(), { error: 'invalid size' })
  })

  test('unknown books are a 404', async () => {
    assert.equal((await call('/api/books/b99/cover')).status, 404)
  })
})

describe('POST /api/books/:id/borrow', () => {
  test('works without a body and defaults to 14 days', async () => {
    const res = await call('/api/books/b2/borrow', { method: 'POST' })
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { bookId: 'b2', days: 14 })
  })

  test('accepts days and caps them at 28', async () => {
    assert.deepEqual(await (await postJson('/api/books/b2/borrow', { days: 7 })).json(), { bookId: 'b2', days: 7 })
    assert.deepEqual(await (await postJson('/api/books/b2/borrow', { days: 90 })).json(), { bookId: 'b2', days: 28 })
  })

  test('unknown books are a 404', async () => {
    assert.equal((await call('/api/books/b99/borrow', { method: 'POST' })).status, 404)
  })
})

describe('users', () => {
  test('JSON sign-up returns 201 with the user', async () => {
    const res = await postJson('/api/users', { name: 'Ana', email: 'ana@example.com' })
    assert.equal(res.status, 201)
    const user = await res.json()
    assert.equal(user.name, 'Ana')
    assert.equal(user.email, 'ana@example.com')
  })

  test('form sign-up keeps the nested address', async () => {
    const res = await call('/api/users', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'name=Ines&email=ines%40example.com&address[city]=Porto&address[zip]=4000-001',
    })
    assert.equal(res.status, 201)
    const user = await res.json()
    assert.equal(user.email, 'ines@example.com')
    assert.deepEqual(user.address, { city: 'Porto', zip: '4000-001' })
  })

  test('missing fields are a 400', async () => {
    const res = await postJson('/api/users', { name: 'NoEmail' })
    assert.equal(res.status, 400)
    assert.deepEqual(await res.json(), { error: 'name and email are required' })
  })

  test('DELETE removes a user with 204, then 404', async () => {
    const first = await call('/api/users/u1', { method: 'DELETE' })
    assert.equal(first.status, 204)
    assert.equal(await first.text(), '')
    assert.equal((await call('/api/users/u1', { method: 'DELETE' })).status, 404)
  })
})

describe('POST /logout', () => {
  test('clears the session cookie and redirects back to the referrer', async () => {
    const res = await call('/logout', { method: 'POST', headers: { referer: 'http://library.example/books?page=2' } })
    assert.equal(res.status, 302)
    assert.equal(res.headers.get('location'), 'http://library.example/books?page=2')
    assert.match(res.headers.get('set-cookie') ?? '', /^sid=;/)
  })

  test('redirects to / without a referrer', async () => {
    const res = await call('/logout', { method: 'POST' })
    assert.equal(res.status, 302)
    assert.equal(res.headers.get('location'), '/')
  })
})

describe('docs', () => {
  test('serves nested docs', async () => {
    const res = await call('/docs/guides/borrowing.md')
    assert.equal(res.status, 200)
    assert.match(await res.text(), /# Borrowing/)
  })

  test('missing docs are a JSON 404', async () => {
    const res = await call('/docs/guides/missing.md')
    assert.equal(res.status, 404)
    assert.deepEqual(await res.json(), { error: 'not_found' })
  })

  test('cannot escape the docs folder', async () => {
    for (const path of ['/docs/..%2Fpackage.json', '/docs/guides/..%2F..%2Fpackage.json', '/docs/..%2Fsrc%2Fapp.js']) {
      const res = await call(path)
      const text = await res.text()
      assert.notEqual(res.status, 200, path)
      assert.ok(res.status >= 400 && res.status < 500, `${path}: expected a 4xx, got ${res.status}`)
      assert.doesNotMatch(text, /library-api|createApp/, path)
    }
  })
})

describe('everything else', () => {
  test('unknown routes are a JSON 404', async () => {
    for (const [method, path] of [
      ['GET', '/api/nope'],
      ['DELETE', '/api/books'],
      ['GET', '/'],
    ]) {
      const res = await call(path, { method })
      assert.equal(res.status, 404, `${method} ${path}`)
      assert.deepEqual(await res.json(), { error: 'not_found' }, `${method} ${path}`)
    }
  })

  test('malformed JSON is a JSON 400', async () => {
    const res = await call('/api/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"name": ',
    })
    assert.equal(res.status, 400)
    assert.equal(typeof (await res.json()).error, 'string')
  })
})
