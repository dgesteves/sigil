import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ListOrdersQuery } from '../src/queries.ts'
import { LEGACY_ID } from './fixtures.ts'

test('an empty query string gets the defaults', () => {
  assert.deepEqual(ListOrdersQuery.parse({}), {
    status: ['pending', 'paid'],
    limit: 20,
    includeArchived: false,
  })
})

test('parses every parameter', () => {
  assert.deepEqual(
    ListOrdersQuery.parse({ status: 'shipped,cancelled', limit: '50', includeArchived: 'true', cursor: LEGACY_ID }),
    { status: ['shipped', 'cancelled'], limit: 50, includeArchived: true, cursor: LEGACY_ID },
  )
})

test('rejects unknown statuses and out-of-range limits', () => {
  assert.equal(ListOrdersQuery.safeParse({ status: 'pending,lost' }).success, false)
  assert.equal(ListOrdersQuery.safeParse({ limit: '500' }).success, false)
})
