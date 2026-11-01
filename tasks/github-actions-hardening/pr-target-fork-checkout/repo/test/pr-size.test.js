import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sizeLabel } from '../scripts/pr-size.mjs'

test('size buckets', () => {
  assert.equal(sizeLabel(0), 'size/XS')
  assert.equal(sizeLabel(9), 'size/XS')
  assert.equal(sizeLabel(10), 'size/S')
  assert.equal(sizeLabel(150), 'size/M')
  assert.equal(sizeLabel(999), 'size/L')
  assert.equal(sizeLabel(1000), 'size/XL')
})
