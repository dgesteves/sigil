import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { lastTestId, type Server, startServer } from './harness.ts'

let server: Server
before(async () => {
  server = await startServer({ INVENTORY_WEBHOOK_SECRET: 'local-test-secret' })
})
after(() => server?.stop())

const get = async (path: string, cookie?: string) => {
  const res = await fetch(server.url + path, { headers: cookie ? { cookie } : {} })
  return { status: res.status, html: await res.text() }
}

test('home lists the catalog', async () => {
  const { status, html } = await get('/')
  assert.equal(status, 200)
  for (const name of ['Gooseneck Kettle', 'Burr Grinder', 'French Press', 'Pour-over Dripper']) {
    assert.match(html, new RegExp(name))
  }
})

test('product page shows name, price and stock', async () => {
  const kettle = await get('/products/p-100')
  assert.equal(kettle.status, 200)
  assert.equal(lastTestId(kettle.html, 'name'), 'Gooseneck Kettle')
  assert.equal(lastTestId(kettle.html, 'price'), '$49.99')
  assert.equal(lastTestId(kettle.html, 'stock'), '12 in stock')

  const press = await get('/products/p-300')
  assert.equal(lastTestId(press.html, 'stock'), 'Out of stock')
})

test('cart badge counts the items in the cart cookie', async () => {
  assert.equal(lastTestId((await get('/')).html, 'cart'), 'Cart (0)')
  assert.equal(lastTestId((await get('/', 'cart=p-100:2,p-300:1')).html, 'cart'), 'Cart (3)')
})
