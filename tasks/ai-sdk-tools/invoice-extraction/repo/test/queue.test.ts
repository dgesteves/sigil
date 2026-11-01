import assert from 'node:assert/strict'
import { test } from 'node:test'
import { summarize } from '../src/queue.ts'

test('summarize formats an invoice for the approval queue', () => {
  const line = summarize({
    vendorName: 'ACME Tools GmbH',
    invoiceNumber: 'INV-1',
    issueDate: '2026-11-03',
    dueDate: null,
    currency: 'EUR',
    lineItems: [],
    total: 12.5,
  })
  assert.equal(line, 'ACME Tools GmbH INV-1: 12.50 EUR, no due date')
})
