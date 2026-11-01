import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { parseOrder } from '../src/orders.ts'
import { Order } from '../src/schemas.ts'
import { item, LEGACY_ID, order } from './fixtures.ts'

function issuesOf(body: unknown) {
  const result = parseOrder(body)
  assert.equal(result.ok, false, 'expected the order to be rejected')
  if (result.ok) throw new Error('unreachable')
  return result.issues
}

function messageAt(body: unknown, path: string): string | undefined {
  return issuesOf(body).find((issue) => issue.path === path)?.message
}

describe('valid orders', () => {
  test('accepts a minimal order and applies defaults', () => {
    const result = parseOrder(order())
    assert.equal(result.ok, true, JSON.stringify(result))
    if (!result.ok) return
    assert.equal(result.order.id, LEGACY_ID)
    assert.equal(result.order.status, 'pending')
    assert.deepEqual(result.order.shipping, { method: 'standard', insured: false })
    assert.equal(result.order.items.length, 2)
  })

  test('accepts price overrides for a subset of regions', () => {
    const result = parseOrder(order({ regionalPrices: { eu: { amount: 1100, currency: 'EUR' } } }))
    assert.equal(result.ok, true, JSON.stringify(result))
  })

  test('keeps storefront metadata when it is sent', () => {
    const result = parseOrder(order({ metadata: { utm: 'newsletter' } }))
    assert.equal(result.ok, true, JSON.stringify(result))
    if (result.ok) assert.deepEqual(result.order.metadata, { utm: 'newsletter' })
  })

  test('accepts IPv4 and IPv6 client addresses', () => {
    assert.equal(parseOrder(order({ placedFromIp: '203.0.113.7' })).ok, true)
    assert.equal(parseOrder(order({ placedFromIp: '2001:db8::1' })).ok, true)
  })

  test('accepts a well-formed discount code', () => {
    assert.equal(parseOrder(order({ discountCode: 'AUTUMN25' })).ok, true)
  })
})

describe('rejected orders keep their messages', () => {
  test('invalid id', () => {
    assert.equal(messageAt(order({ id: 'order-17' }), 'id'), 'Invalid order id')
  })

  test('invalid email', () => {
    assert.equal(messageAt(order({ customerEmail: 'grace' }), 'customerEmail'), 'Invalid email')
  })

  test('no items', () => {
    assert.equal(messageAt(order({ items: [] }), 'items'), 'An order needs at least one item')
  })

  test('missing SKU', () => {
    assert.equal(messageAt(order({ items: [item({ sku: undefined })] }), 'items.0.sku'), 'SKU is required')
  })

  test('non-string SKU', () => {
    assert.equal(messageAt(order({ items: [item({ sku: 42 })] }), 'items.0.sku'), 'SKU must be a string')
  })

  test('too-long SKU reports the length limit', () => {
    const message = messageAt(order({ items: [item({ sku: 'X'.repeat(33) })] }), 'items.0.sku')
    assert.ok(message, 'expected an issue at items.0.sku')
    assert.match(message, /32/)
  })

  test('non-numeric quantity', () => {
    assert.equal(messageAt(order({ items: [item({ quantity: 'two' })] }), 'items.0.quantity'), 'Quantity must be a number')
  })

  test('malformed discount code echoes the code', () => {
    assert.equal(messageAt(order({ discountCode: 'abc' }), 'discountCode'), 'Unknown discount code format: abc')
  })

  test('invalid client address', () => {
    assert.ok(messageAt(order({ placedFromIp: 'localhost' }), 'placedFromIp'))
  })

  test('unknown top-level keys are rejected', () => {
    const result = Order.safeParse(order({ couponCode: 'X' }))
    assert.equal(result.success, false)
    assert.ok(result.error?.issues.some((issue) => issue.code === 'unrecognized_keys'))
  })
})
