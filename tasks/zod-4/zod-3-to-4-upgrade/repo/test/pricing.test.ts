import assert from 'node:assert/strict'
import { test } from 'node:test'
import { orderTotal } from '../src/pricing.ts'
import { canCancel, terminalStatuses } from '../src/status.ts'
import { item, order } from './fixtures.ts'

test('totals an order from raw JSON', () => {
  assert.deepEqual(orderTotal(order()), { amount: 2 * 1250 + 199, currency: 'EUR' })
})

test('refuses invalid orders', () => {
  assert.throws(() => orderTotal(order({ items: [] })))
})

test('refuses mixed currencies', () => {
  const mixed = order({ items: [item(), item({ unitPrice: { amount: 100, currency: 'USD' } })] })
  assert.throws(() => orderTotal(mixed), /Mixed currencies/)
})

test('only open orders can be cancelled', () => {
  assert.equal(canCancel('pending'), true)
  assert.equal(canCancel('paid'), true)
  assert.equal(canCancel('shipped'), false)
  assert.equal(canCancel('cancelled'), false)
  assert.deepEqual([...terminalStatuses], ['shipped', 'cancelled'])
})
