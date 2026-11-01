import assert from 'node:assert/strict'
import { test } from 'node:test'
import { validateEntry } from '../src/postings.js'

const ok = {
  id: 'je-1',
  postings: [
    { account: '1200', side: 'debit', cents: 1999 },
    { account: '4000-01', side: 'credit', cents: 1999 },
  ],
}

test('a balanced entry is valid', () => {
  assert.deepEqual(validateEntry(ok), [])
})

test('an unbalanced entry is rejected', () => {
  const entry = structuredClone(ok)
  entry.postings[1].cents = 1000
  assert.match(validateEntry(entry).join(), /unbalanced/)
})

test('amounts must be positive integer cents', () => {
  const entry = structuredClone(ok)
  entry.postings[0].cents = 19.99
  assert.match(validateEntry(entry).join(), /positive integer/)
})
