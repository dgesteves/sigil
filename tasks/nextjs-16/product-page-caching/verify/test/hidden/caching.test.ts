import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, describe, test } from 'node:test'
import { forms, lastTestId, readJson, type Server, setField, sleep, startServer, writeJson } from './harness.ts'

const SECRET = 'hidden-test-secret'
const STAFF = 'staff_session=stf_0b5d8f6a2c'
const CATALOG = 'data/catalog.json'
type Catalog = Record<string, { priceCents: number; stock: number; name: string }>

let server: Server
before(async () => {
  server = await startServer({ INVENTORY_WEBHOOK_SECRET: SECRET })
})
after(() => server?.stop())

const reads = (id: string) =>
  readFileSync('data/reads.log', 'utf8')
    .split('\n')
    .filter((line) => line === `product ${id}`).length

async function product(id: string, cookie?: string) {
  const { status, html } = await server.get(`/products/${id}`, cookie)
  assert.equal(status, 200, `GET /products/${id} returned ${status}\n${server.output().slice(-2000)}`)
  return {
    html,
    name: lastTestId(html, 'name'),
    price: lastTestId(html, 'price'),
    stock: lastTestId(html, 'stock'),
    cart: lastTestId(html, 'cart'),
  }
}

describe('shopper views', () => {
  test('product pages still show name, price and stock', async () => {
    const kettle = await product('p-100')
    assert.equal(kettle.name, 'Gooseneck Kettle')
    assert.equal(kettle.price, '$49.99')
    assert.equal(kettle.stock, '12 in stock')
    assert.equal((await product('p-300')).stock, 'Out of stock')
  })

  test('repeat views of a product do not query the catalog database', async () => {
    for (const id of ['p-100', 'p-200', 'p-400']) {
      await product(id)
      const before = reads(id)
      for (let i = 0; i < 4; i++) {
        const view = await product(id)
        assert.ok(view.price?.startsWith('$'), `product ${id} rendered without a price`)
      }
      assert.equal(reads(id), before, `4 repeat views of ${id} queried the database ${reads(id) - before} more times`)
    }
  })

  test("the cart badge on a product page shows each visitor's own cart", async () => {
    assert.equal((await product('p-100', 'cart=p-100:2,p-300:1')).cart, 'Cart (3)')
    assert.equal((await product('p-100')).cart, 'Cart (0)')
    assert.equal((await product('p-100', 'cart=p-200:5')).cart, 'Cart (5)')
    assert.equal((await product('p-200', 'cart=p-400:1')).cart, 'Cart (1)')
  })
})

describe('editor price changes', () => {
  async function priceForm(id: string) {
    const { status, html } = await server.get(`/admin/products/${id}`, STAFF)
    assert.equal(status, 200)
    const form = forms(html).find((f) => f.fields.some(([k]) => k === 'price'))
    assert.ok(form, 'the admin page has no server-rendered form with a "price" field')
    return form
  }

  test('the editor sees the new price after saving, on the redirect and on reload', async () => {
    assert.equal((await product('p-200')).price, '$129.00')
    const form = await priceForm('p-200')
    const res = await server.submit('/admin/products/p-200', setField(form.fields, 'price', '99.50'), STAFF)
    assert.ok(res.status === 303 || res.status === 200, `saving returned ${res.status}\n${server.output().slice(-2000)}`)
    if (res.status === 303) assert.equal(new URL(res.headers.get('location')!, server.url).pathname, '/products/p-200')
    assert.equal(readJson<Catalog>(CATALOG)['p-200']!.priceCents, 9950)

    assert.equal((await product('p-200')).price, '$99.50', 'first view after saving still shows the old price')
    assert.equal((await product('p-200')).price, '$99.50', 'reload after saving shows the old price')
    assert.equal((await product('p-200', 'cart=p-200:1')).price, '$99.50')
  })

  test('a second save is visible straight away too', async () => {
    const form = await priceForm('p-100')
    await product('p-100')
    await server.submit('/admin/products/p-100', setField(form.fields, 'price', '$45.00'), STAFF)
    assert.equal((await product('p-100')).price, '$45.00')
  })

  test('people who are not staff still cannot change prices', async () => {
    const form = await priceForm('p-400')
    await server.submit('/admin/products/p-400', setField(form.fields, 'price', '1.00'))
    await server.submit('/admin/products/p-400', setField(form.fields, 'price', '1.00'), 'staff_session=forged')
    assert.equal(readJson<Catalog>(CATALOG)['p-400']!.priceCents, 2200)
    assert.equal((await product('p-400')).price, '$22.00')
  })
})

describe('warehouse webhook', () => {
  const notify = (productIds: string[], secret = SECRET) =>
    fetch(`${server.url}/api/inventory`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-inventory-secret': secret },
      body: JSON.stringify({ productIds }),
    })

  test('stock changes reach the product page within a few seconds', async () => {
    assert.equal((await product('p-400')).stock, '31 in stock')
    assert.equal((await product('p-300')).stock, 'Out of stock')
    const catalog = readJson<Catalog>(CATALOG)
    catalog['p-400']!.stock = 7
    catalog['p-300']!.stock = 2
    writeJson(CATALOG, catalog)

    const res = await notify(['p-400', 'p-300'])
    assert.ok(res.ok, `webhook returned ${res.status}: ${await res.text()}\n${server.output().slice(-2000)}`)

    for (const [id, expected] of [['p-400', '7 in stock'], ['p-300', '2 in stock']] as const) {
      let seen: string | undefined
      for (let i = 0; i < 20 && seen !== expected; i++) {
        seen = (await product(id)).stock
        if (seen !== expected) await sleep(250)
      }
      assert.equal(seen, expected, `${id} still shows "${seen}" 5 seconds after the webhook`)
    }
  })

  test('the webhook still rejects a wrong secret', async () => {
    const res = await notify(['p-100'], 'nope')
    assert.equal(res.status, 401)
  })
})
