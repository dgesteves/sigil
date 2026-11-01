import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderLabel } from '../src/labels.js'

test('renders a one-page PDF label', async () => {
  const pdf = await renderLabel({
    id: 'shp_1',
    name: 'Ada Lovelace',
    street: '12 St James Square',
    postcode: 'SW1Y 4JH',
    city: 'London',
  })
  assert.match(pdf.toString(), /^%PDF-1\.4/)
  assert.match(pdf.toString(), /Ada Lovelace/)
})
