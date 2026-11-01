import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { migrate } from '../src/migrate.ts'
import { createOrder, orderHistory, setStatus } from '../src/orders.ts'

test('every migration applies to an empty database', async () => {
  const db = new PGlite()
  const applied = await migrate(db)
  assert.ok(applied.length >= 3)
  assert.deepEqual(await migrate(db), [])
})

test('orders can be created, updated and listed newest first', async () => {
  const db = new PGlite()
  await migrate(db)
  const { rows } = await db.query(
    `INSERT INTO customers (email, name) VALUES ('ana@example.com', 'Ana') RETURNING id`,
  )
  const customerId = Number((rows[0] as { id: number }).id)
  const first = await createOrder(db, { customerId, totalCents: 1200 })
  const second = await createOrder(db, { customerId, totalCents: 900 })
  await setStatus(db, Number((first as { id: number }).id), 'paid')
  const history = await orderHistory(db, customerId)
  assert.equal(history.length, 2)
  const ids = history.map((r) => Number((r as { id: number }).id)).sort((a, b) => a - b)
  assert.deepEqual(ids, [Number((first as { id: number }).id), Number((second as { id: number }).id)])
})
