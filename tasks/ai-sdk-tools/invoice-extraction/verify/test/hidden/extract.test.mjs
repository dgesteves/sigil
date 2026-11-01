import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { InvoiceExtractionError } from '../../src/errors.ts'
import { extractInvoice } from '../../src/extract.ts'
import { scriptedModel, text } from './_model.mjs'

const EMAIL = readFileSync(new URL('../../fixtures/acme-email.txt', import.meta.url), 'utf8')

const ACME = {
  vendorName: 'ACME Tools GmbH',
  invoiceNumber: 'INV-2026-0417',
  issueDate: '2026-11-03',
  dueDate: '2026-12-03',
  currency: 'EUR',
  lineItems: [
    { description: 'Cordless drill DX-20', quantity: 2, unitPrice: 149 },
    { description: 'Drill bit set (10 pcs)', quantity: 5, unitPrice: 18.5 },
  ],
  total: 390.5,
}

async function run(modelText) {
  const model = scriptedModel([text(modelText)])
  const invoice = await extractInvoice(model, EMAIL)
  return { model, invoice }
}

async function assertExtractionError(modelText) {
  const model = scriptedModel([text(modelText)])
  await assert.rejects(extractInvoice(model, EMAIL), (error) => {
    assert.ok(
      error instanceof InvoiceExtractionError,
      `expected InvoiceExtractionError, got ${error?.constructor?.name}: ${error?.message}`,
    )
    assert.equal(error.rawText, modelText, 'rawText must be the raw model text')
    assert.notEqual(error.cause, undefined, 'the underlying error must be attached as cause')
    return true
  })
}

test('returns the invoice the model extracted', async () => {
  const { invoice } = await run(JSON.stringify(ACME))
  assert.deepEqual(invoice, ACME)
})

test('a missing due date comes back as null', async () => {
  const { invoice } = await run(JSON.stringify({ ...ACME, dueDate: null }))
  assert.equal(invoice.dueDate, null)
})

test('asks for JSON-schema structured output covering every Invoice field', async () => {
  const { model } = await run(JSON.stringify(ACME))
  const format = model.calls[0].responseFormat
  assert.equal(format?.type, 'json', `responseFormat was ${JSON.stringify(format)}`)
  const props = Object.keys(format.schema?.properties ?? {})
  for (const key of Object.keys(ACME)) {
    assert.ok(props.includes(key), `structured output schema lacks "${key}" (has ${props.join(', ')})`)
  }
})

test('runs at temperature 0 with a 1,000 output token cap', async () => {
  const { model } = await run(JSON.stringify(ACME))
  assert.equal(model.calls[0].temperature, 0)
  assert.equal(model.calls[0].maxOutputTokens, 1000)
})

test('sends the email to the model', async () => {
  const { model } = await run(JSON.stringify(ACME))
  assert.ok(JSON.stringify(model.calls[0].prompt).includes('INV-2026-0417'))
})

test('unparseable output raises InvoiceExtractionError with the raw text', async () => {
  await assertExtractionError('Sorry, I cannot read this invoice.')
})

test('a currency that is not a 3-letter code is rejected', async () => {
  await assertExtractionError(JSON.stringify({ ...ACME, currency: 'EURO' }))
})

test('a date that is not YYYY-MM-DD is rejected', async () => {
  await assertExtractionError(JSON.stringify({ ...ACME, issueDate: '03/11/2026' }))
})

test('a non-positive quantity is rejected', async () => {
  const lineItems = [{ ...ACME.lineItems[0], quantity: -2 }]
  await assertExtractionError(JSON.stringify({ ...ACME, lineItems }))
})

test('a missing total is rejected', async () => {
  const { total, ...withoutTotal } = ACME
  void total
  await assertExtractionError(JSON.stringify(withoutTotal))
})
