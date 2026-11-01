import assert from 'node:assert/strict'
import { test } from 'node:test'
import { convert, units } from '../src/index.js'

test('converts within a dimension', () => {
  assert.equal(convert(1, 'km', 'm'), 1000)
  assert.ok(Math.abs(convert(1, 'mi', 'ft') - 5280) < 1e-9)
  assert.equal(convert(90, 'min', 'h'), 1.5)
})

test('rejects unknown units and mixed dimensions', () => {
  assert.throws(() => convert(1, 'parsec', 'm'), RangeError)
  assert.throws(() => convert(1, 'kg', 'm'), TypeError)
})

test('lists units per dimension', () => {
  assert.deepEqual(units('time'), ['s', 'min', 'h', 'd'])
})
