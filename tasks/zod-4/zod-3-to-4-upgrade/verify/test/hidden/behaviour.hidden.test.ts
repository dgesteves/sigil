// Behaviour the API had on Zod 3 that the upgrade must keep. Default message wording changed between
// Zod 3 and 4, so these tests only pin custom messages, issue codes and paths.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { toApiIssues } from '../../src/errors.ts'
import { parseOrder } from '../../src/orders.ts'
import { orderTotal } from '../../src/pricing.ts'
import { ListOrdersQuery } from '../../src/queries.ts'
import { Order } from '../../src/schemas.ts'
import { canCancel, terminalStatuses } from '../../src/status.ts'
import { item, OTHER_LEGACY_ID, order } from '../fixtures.ts'

function issuesAt(body: unknown, path: string) {
  const result = Order.safeParse(body)
  assert.equal(result.success, false, 'expected the order to be rejected')
  return (result.error?.issues ?? []).filter((issue) => issue.path.join('.') === path)
}

describe('legacy order ids', () => {
  for (const id of [OTHER_LEGACY_ID, 'ABCDEF01-2345-6789-ABCD-EF0123456789', 'deadbeef-dead-beef-dead-beefdeadbeef']) {
    test(`accepts ${id}`, () => assert.equal(parseOrder(order({ id })).ok, true))
  }
  for (const id of ['7f3a9c2e-0000-1000-0000-00000000a1b', '7f3a9c2e00001000000000000000a1b2', 'gggggggg-0000-1000-0000-00000000a1b2', '']) {
    test(`rejects ${JSON.stringify(id)} with the custom message`, () => {
      assert.deepEqual(
        issuesAt(order({ id }), 'id').map((issue) => issue.message),
        ['Invalid order id'],
      )
    })
  }
  test('cursor uses the same id rules', () => {
    assert.equal(ListOrdersQuery.safeParse({ cursor: OTHER_LEGACY_ID }).success, true)
    assert.equal(ListOrdersQuery.safeParse({ cursor: 'nope' }).success, false)
  })
})

describe('custom messages only replace the cases they were written for', () => {
  test('missing SKU on a later item', () => {
    const issues = issuesAt(order({ items: [item(), item({ sku: undefined })] }), 'items.1.sku')
    assert.deepEqual(
      issues.map((i) => i.message),
      ['SKU is required'],
    )
  })

  test('empty SKU is a length problem, not a type problem', () => {
    const [issue] = issuesAt(order({ items: [item({ sku: '' })] }), 'items.0.sku')
    assert.ok(issue)
    assert.equal(issue.code, 'too_small')
    assert.doesNotMatch(issue.message, /SKU is required|SKU must be a string/)
  })

  test('too-long SKU is a length problem, not a type problem', () => {
    const [issue] = issuesAt(order({ items: [item({ sku: 'X'.repeat(40) })] }), 'items.0.sku')
    assert.ok(issue)
    assert.equal(issue.code, 'too_big')
    assert.doesNotMatch(issue.message, /SKU is required|SKU must be a string/)
  })

  test('zero quantity is a range problem, not a type problem', () => {
    const [issue] = issuesAt(order({ items: [item({ quantity: 0 })] }), 'items.0.quantity')
    assert.ok(issue)
    assert.equal(issue.code, 'too_small')
    assert.doesNotMatch(issue.message, /must be a number/i)
  })

  test('missing quantity', () => {
    const [issue] = issuesAt(order({ items: [item({ quantity: undefined })] }), 'items.0.quantity')
    assert.equal(issue?.message, 'Quantity must be a number')
  })

  test('discount code message echoes any rejected code', () => {
    assert.deepEqual(
      issuesAt(order({ discountCode: 'lower123' }), 'discountCode').map((i) => i.message),
      ['Unknown discount code format: lower123'],
    )
  })
})

describe('defaults', () => {
  test('partial shipping options are completed', () => {
    const result = parseOrder(order({ shipping: { method: 'express' } }))
    assert.equal(result.ok, true)
    if (result.ok) assert.deepEqual(result.order.shipping, { method: 'express', insured: false })
  })

  test('default shipping options are a fresh object per parse', () => {
    const first = Order.parse(order())
    first.shipping.insured = true
    assert.deepEqual(Order.parse(order()).shipping, { method: 'standard', insured: false })
  })

  test('explicit status wins over the default', () => {
    assert.equal(Order.parse(order({ status: 'paid' })).status, 'paid')
  })

  test('query defaults are real values, not strings', () => {
    const query = ListOrdersQuery.parse({ limit: '5' })
    assert.ok(Array.isArray(query.status))
    assert.deepEqual([...query.status], ['pending', 'paid'])
    assert.equal(query.limit, 5)
    assert.equal(query.includeArchived, false)
  })

  test('includeArchived=1 is true', () => {
    assert.equal(ListOrdersQuery.parse({ includeArchived: '1' }).includeArchived, true)
  })

  for (const limit of ['0', '101', 'ten', '2.5']) {
    test(`limit ${limit} is rejected`, () => assert.equal(ListOrdersQuery.safeParse({ limit }).success, false))
  }
})

describe('regional prices', () => {
  for (const regionalPrices of [{}, { us: { amount: 1300, currency: 'USD' } }, { eu: { amount: 1, currency: 'EUR' }, us: { amount: 2, currency: 'USD' }, uk: { amount: 3, currency: 'GBP' } }]) {
    test(`accepts ${Object.keys(regionalPrices).join(',') || 'none'}`, () => {
      assert.equal(parseOrder(order({ regionalPrices })).ok, true)
    })
  }
  test('rejects unknown regions', () => {
    assert.equal(parseOrder(order({ regionalPrices: { mars: { amount: 1, currency: 'EUR' } } })).ok, false)
  })
  test('rejects invalid prices', () => {
    assert.equal(parseOrder(order({ regionalPrices: { eu: { amount: -5, currency: 'EUR' } } })).ok, false)
  })
})

describe('optional fields', () => {
  test('metadata may be absent or any value', () => {
    assert.equal(parseOrder(order()).ok, true)
    for (const metadata of [null, 'campaign-7', 42, ['a'], { nested: { deep: true } }]) {
      const result = parseOrder(order({ metadata }))
      assert.equal(result.ok, true)
      if (result.ok) assert.deepEqual(result.order.metadata, metadata)
    }
  })

  for (const ip of ['10.0.0.1', '::1', 'fe80::1']) {
    test(`accepts client address ${ip}`, () => assert.equal(parseOrder(order({ placedFromIp: ip })).ok, true))
  }
  for (const ip of ['999.1.1.1', '10.0.0', 'example.com']) {
    test(`rejects client address ${ip}`, () => assert.equal(parseOrder(order({ placedFromIp: ip })).ok, false))
  }
})

describe('error formatting and helpers', () => {
  test('toApiIssues joins paths and keeps every issue', () => {
    const result = Order.safeParse(order({ customerEmail: 'nope', items: [item({ sku: 42, quantity: 'x' })] }))
    assert.equal(result.success, false)
    if (result.success) return
    const issues = toApiIssues(result.error)
    assert.deepEqual(
      issues.map((i) => i.path).sort(),
      ['customerEmail', 'items.0.quantity', 'items.0.sku'],
    )
    assert.ok(issues.every((i) => typeof i.message === 'string' && i.message.length > 0))
  })

  test('orderTotal validates its input and applies defaults', () => {
    assert.deepEqual(orderTotal(order({ items: [item({ quantity: 3 })] })), { amount: 3750, currency: 'EUR' })
    assert.throws(() => orderTotal({ ...order(), id: 'nope' }))
    assert.throws(() => orderTotal(undefined))
  })

  test('status helpers', () => {
    assert.deepEqual([...terminalStatuses], ['shipped', 'cancelled'])
    assert.equal(canCancel('paid'), true)
    assert.equal(canCancel('cancelled'), false)
  })
})
