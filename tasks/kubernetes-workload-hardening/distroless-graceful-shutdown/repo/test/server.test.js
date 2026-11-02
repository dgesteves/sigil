import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { server } from '../src/server.js'

let base
before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${server.address().port}`
})
after(() => server.close())

test('balance of a known account', async () => {
  const res = await fetch(`${base}/accounts/acc_ops/balance`)
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.account, 'acc_ops')
  assert.equal(typeof body.balanceCents, 'number')
})

test('export streams one CSV row per entry', async () => {
  const res = await fetch(`${base}/accounts/acc_payroll/export?rows=5`)
  assert.equal(res.status, 200)
  const lines = (await res.text()).trim().split('\n')
  assert.equal(lines[0], 'id,amount_cents,booked_at')
  assert.equal(lines.length, 6)
})

test('unknown accounts are 404', async () => {
  assert.equal((await fetch(`${base}/accounts/nope/balance`)).status, 404)
})
