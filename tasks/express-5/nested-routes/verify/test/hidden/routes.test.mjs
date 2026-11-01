import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { createApp } from '../../src/app.mjs'

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

const get = (path) => fetch(base + path, { signal: AbortSignal.timeout(5000) })

async function json(res) {
  assert.match(res.headers.get('content-type') ?? '', /^application\/json/)
  return res.json()
}

const skus = (body) => body.products.map((p) => p.sku).sort()

// Minimal RFC 4180 reader: enough to read back a header and one row without caring about quoting style.
function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += c
  }
  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((f) => f !== ''))
}

describe('GET /api/categories/<path>', () => {
  test('a top-level category includes products from every level below it', async () => {
    const res = await get('/api/categories/electronics')
    assert.equal(res.status, 200)
    const body = await json(res)
    assert.equal(body.path, 'electronics')
    assert.deepEqual(skus(body), ['CAM-7', 'HP-200', 'HP-310', 'SPK-10'])
  })

  test('a two-level path', async () => {
    const res = await get('/api/categories/electronics/audio')
    assert.equal(res.status, 200)
    const body = await json(res)
    assert.equal(body.path, 'electronics/audio')
    assert.deepEqual(skus(body), ['HP-200', 'HP-310', 'SPK-10'])
  })

  test('a three-level path', async () => {
    const res = await get('/api/categories/home/kitchen/cookware')
    assert.equal(res.status, 200)
    const body = await json(res)
    assert.equal(body.path, 'home/kitchen/cookware')
    assert.deepEqual(skus(body), ['PAN-12'])
  })

  test('a known category without products returns an empty list', async () => {
    const res = await get('/api/categories/home/garden')
    assert.equal(res.status, 200)
    const body = await json(res)
    assert.equal(body.path, 'home/garden')
    assert.deepEqual(body.products, [])
  })

  test('unknown categories return a JSON 404', async () => {
    for (const path of ['/api/categories/toys', '/api/categories/electronics/aud', '/api/categories/home/kitchen/knives']) {
      const res = await get(path)
      assert.equal(res.status, 404, path)
      assert.deepEqual(await json(res), { error: 'not_found' }, path)
    }
  })
})

describe('GET /api/products/:sku', () => {
  test('returns the product as JSON', async () => {
    const res = await get('/api/products/HP-200')
    assert.equal(res.status, 200)
    const body = await json(res)
    assert.equal(body.sku, 'HP-200')
    assert.equal(body.name, 'Studio Headphones')
    assert.equal(body.price, 129)
  })

  test('returns the product as CSV with a .csv suffix', async () => {
    const res = await get('/api/products/SPK-10.csv')
    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-type') ?? '', /^text\/csv/)
    const rows = parseCsv(await res.text())
    assert.equal(rows.length, 2, 'a header line and one row')
    assert.deepEqual(rows[0], ['sku', 'name', 'price'])
    assert.equal(rows[1][0], 'SPK-10')
    assert.equal(rows[1][1], 'Bookshelf Speaker')
    assert.equal(Number(rows[1][2]), 89.9)
  })

  test('unknown SKUs return a JSON 404 in both forms', async () => {
    for (const path of ['/api/products/NOPE-1', '/api/products/NOPE-1.csv']) {
      const res = await get(path)
      assert.equal(res.status, 404, path)
      assert.deepEqual(await json(res), { error: 'not_found' }, path)
    }
  })
})

test('existing endpoints keep working', async () => {
  assert.equal((await get('/api/health')).status, 200)
  const res = await get('/api/products')
  assert.equal(res.status, 200)
  assert.equal((await json(res)).products.length, 6)
  const missing = await get('/api/nope')
  assert.equal(missing.status, 404)
})
