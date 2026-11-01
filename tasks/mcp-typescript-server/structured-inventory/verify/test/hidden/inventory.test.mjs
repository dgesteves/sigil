import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import {
  assertExitedOnEof,
  assertOnlyProtocolOnStdout,
  connect,
  rawSession,
  textOf,
  typecheck,
} from './harness.mjs'

// From data/inventory.json (protected).
const ITEMS = [
  { sku: 'SKU-1001', name: 'Travel mug', priceCents: 1850, stock: { LIS: 4, NYC: 7, BER: 2 } },
  { sku: 'SKU-1002', name: 'Pour-over kettle', priceCents: 4900, stock: { LIS: 1 } },
  { sku: 'SKU-1003', name: 'Burr grinder', priceCents: 12900, stock: { NYC: 3, BER: 5 } },
  { sku: 'SKU-1004', name: 'Paper filters (100)', priceCents: 650, stock: { LIS: 40, NYC: 25, BER: 31 } },
  { sku: 'SKU-1005', name: 'Cupping spoon', priceCents: 1200, stock: { BER: 9 } },
]

let client
before(async () => {
  client = await connect()
})
after(async () => {
  await client?.close()
})

/** Follows local `#/$defs/...` references so schemas that factor out sub-objects are accepted. */
function deref(schema, root) {
  let s = schema
  while (s && typeof s.$ref === 'string' && s.$ref.startsWith('#/')) {
    s = s.$ref
      .slice(2)
      .split('/')
      .reduce((node, key) => node?.[key], root)
  }
  return s
}

const byWarehouse = (stock) =>
  Object.entries(stock)
    .map(([warehouse, qty]) => ({ warehouse, qty }))
    .sort((a, b) => a.warehouse.localeCompare(b.warehouse))

test('get_item advertises an output schema with the requested shape', async () => {
  const { tools } = await client.listTools()
  const tool = tools.find((t) => t.name === 'get_item')
  assert.ok(tool, 'get_item must still be listed')
  const root = tool.outputSchema
  assert.ok(root, 'get_item should declare an outputSchema so clients can validate results')
  const props = deref(root, root).properties ?? {}
  for (const key of ['sku', 'name', 'priceCents', 'stock']) {
    assert.ok(key in props, `outputSchema is missing "${key}"`)
  }
  const stock = deref(props.stock, root)
  assert.ok(stock?.properties?.total, 'outputSchema stock.total is missing')
  const list = deref(stock.properties.byWarehouse, root)
  assert.equal(list?.type, 'array', 'stock.byWarehouse should be an array')
  const entry = deref(list.items, root)
  assert.ok(
    entry?.properties?.warehouse && entry?.properties?.qty,
    'byWarehouse entries need warehouse and qty',
  )
})

test('get_item returns structured content plus a readable summary for every SKU', async () => {
  for (const item of ITEMS) {
    const result = await client.callTool({ name: 'get_item', arguments: { sku: item.sku } })
    assert.notEqual(result.isError, true, `get_item ${item.sku} failed: ${textOf(result)}`)
    const sc = result.structuredContent
    assert.ok(sc && typeof sc === 'object', `get_item ${item.sku} returned no structuredContent`)
    assert.equal(sc.sku, item.sku)
    assert.equal(sc.name, item.name)
    assert.equal(sc.priceCents, item.priceCents)
    const total = Object.values(item.stock).reduce((a, b) => a + b, 0)
    assert.equal(sc.stock?.total, total, `${item.sku} stock.total`)
    assert.ok(Array.isArray(sc.stock?.byWarehouse), `${item.sku} stock.byWarehouse`)
    assert.deepEqual(
      [...sc.stock.byWarehouse]
        .map((w) => ({ warehouse: w.warehouse, qty: w.qty }))
        .sort((a, b) => a.warehouse.localeCompare(b.warehouse)),
      byWarehouse(item.stock),
      `${item.sku} stock.byWarehouse`,
    )
    assert.ok(
      textOf(result).includes(item.name),
      'a text block should still summarise the item for clients that ignore structured output',
    )
  }
})

test('an unknown SKU is a tool error the model can read', async () => {
  const result = await client.callTool({ name: 'get_item', arguments: { sku: 'SKU-9999' } })
  assert.equal(result.isError, true)
  assert.ok(textOf(result).length > 0)
})

test('every item is discoverable through resources/list', async () => {
  const { resources } = await client.listResources()
  const uris = new Set(resources.map((r) => r.uri))
  for (const item of ITEMS) {
    assert.ok(
      uris.has(`inventory://items/${item.sku}`),
      `inventory://items/${item.sku} is not listed; got ${[...uris].join(', ')}`,
    )
  }
})

test('reading an item resource returns the item as JSON', async () => {
  for (const item of ITEMS) {
    const uri = `inventory://items/${item.sku}`
    const { contents } = await client.readResource({ uri })
    assert.ok(contents?.length >= 1, `${uri} returned no contents`)
    const [first] = contents
    assert.equal(first.mimeType, 'application/json', `${uri} mimeType`)
    assert.equal(typeof first.text, 'string', `${uri} should be text contents`)
    const parsed = JSON.parse(first.text)
    assert.equal(parsed.sku, item.sku)
    assert.equal(parsed.name, item.name)
  }
})

test('reading an unknown item fails with a not-found error', async () => {
  await assert.rejects(
    client.readResource({ uri: 'inventory://items/SKU-9999' }),
    (err) =>
      err.code !== -32601 &&
      ([-32002, -32602].includes(err.code) ||
        /not.?found|unknown|no item|does not exist/i.test(err.message)),
    'reading a missing item should be a JSON-RPC not-found error, not an empty or placeholder result',
  )
})

test('stdout carries only MCP messages and the server exits when stdin closes', async () => {
  const { stdout, responses, exit } = await rawSession([
    { method: 'tools/call', params: { name: 'get_item', arguments: { sku: 'SKU-1003' } } },
    { method: 'resources/list' },
    { method: 'resources/read', params: { uri: 'inventory://items/SKU-1003' } },
  ])
  assert.ok(responses[0].result && responses[2].result, 'calls should succeed')
  assertOnlyProtocolOnStdout(stdout)
  assertExitedOnEof(exit)
})

test('the project still type-checks', () => {
  const { ok, output } = typecheck()
  assert.ok(ok, `npm run typecheck fails:\n${output.slice(0, 2000)}`)
})
