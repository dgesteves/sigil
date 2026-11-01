import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { applyToEmptyDatabase, describe, type Prepared, prepare, sqlState } from './harness.ts'

const ORIGINAL = [
  '0001_create_customers.sql',
  '0002_create_orders.sql',
  '0003_orders_notes.sql',
  '0004_deleted_customer_placeholder.sql',
]

// The placeholder customer is id 1; 2,000 real customers follow. Every 2,700th order points at a
// customer that no longer exists (37 orphans).
const SEED = `
INSERT INTO customers (email, name)
SELECT 'customer' || g || '@example.com', 'Customer ' || g FROM generate_series(1, 2000) g;

INSERT INTO orders (customer_id, status, total_cents, created_at, updated_at)
SELECT CASE WHEN g % 2700 = 0 THEN 900000 + g ELSE 2 + (g * 7919) % 2000 END,
       (ARRAY['pending', 'paid', 'shipped', 'delivered'])[1 + g % 4],
       (g * 31) % 20000,
       timestamptz '2019-06-01 00:00:00+00' + g * interval '9 minutes',
       timestamptz '2019-06-01 00:00:00+00' + g * interval '9 minutes'
FROM generate_series(1, 100000) g;`

let ctx: Prepared

before(async () => {
  ctx = await prepare({
    original: ORIGINAL,
    seed: SEED,
    hot: ['orders', 'customers'],
    snapshot: ['id', 'customer_id', 'total_cents', 'status'],
  })
})

after(async () => {
  await ctx?.db.close()
})

test('new migrations apply on top of the production schema and data', () => {
  assert.ok(ctx.applied.length > 0, 'expected at least one new file in migrations/')
})

test('orders.customer_id is a validated foreign key to customers(id)', async () => {
  const { rows } = await ctx.db.query<{ validated: boolean }>(
    `SELECT c.convalidated AS validated
     FROM pg_constraint c
     WHERE c.contype = 'f' AND c.conrelid = 'orders'::regclass AND c.confrelid = 'customers'::regclass
       AND c.conkey = ARRAY[(SELECT attnum FROM pg_attribute
                             WHERE attrelid = 'orders'::regclass AND attname = 'customer_id')]
       AND c.confkey = ARRAY[(SELECT attnum FROM pg_attribute
                              WHERE attrelid = 'customers'::regclass AND attname = 'id')]`,
  )
  assert.equal(rows.length, 1, 'expected one foreign key from orders(customer_id) to customers(id)')
  assert.equal(rows[0]!.validated, true, 'the foreign key exists but was never validated')
})

test('every constraint on orders is validated', async () => {
  const { rows } = await ctx.db.query(
    `SELECT conname FROM pg_constraint WHERE conrelid = 'orders'::regclass AND NOT convalidated`,
  )
  assert.deepEqual(rows, [])
})

test('orphaned orders now belong to the placeholder customer and nothing else changed', async () => {
  const { rows } = await ctx.db.query<{ moved: number; kept: number; other: number; total: number }>(
    `SELECT
       count(*) FILTER (WHERE b.customer_id > 900000 AND o.customer_id = p.id)::int AS moved,
       count(*) FILTER (WHERE b.customer_id <= 900000 AND o.customer_id = b.customer_id
                        AND o.total_cents = b.total_cents AND o.status = b.status)::int AS kept,
       count(*) FILTER (WHERE b.customer_id > 900000 AND o.customer_id <> p.id)::int AS other,
       (SELECT count(*) FROM orders)::int AS total
     FROM verify_orders_before b
     JOIN orders o USING (id)
     CROSS JOIN (SELECT id FROM customers WHERE email = 'deleted-customer@internal.invalid') p`,
  )
  assert.deepEqual(rows[0], { moved: 37, kept: 100000 - 37, other: 0, total: 100000 })
})

test('the database rejects unknown customers, deleting customers with orders, and negative totals', async () => {
  const { db } = ctx
  assert.equal(
    await sqlState(db, 'INSERT INTO orders (customer_id, total_cents) VALUES (99999999, 100)'),
    '23503',
    'an order for a customer that does not exist was accepted',
  )
  // NO ACTION raises foreign_key_violation (23503); RESTRICT raises restrict_violation (23001).
  assert.ok(
    ['23503', '23001'].includes(String(await sqlState(db, 'DELETE FROM customers WHERE id = 2'))),
    'deleting a customer who has orders should fail',
  )
  assert.equal(
    await sqlState(db, 'INSERT INTO orders (customer_id, total_cents) VALUES (2, -1)'),
    '23514',
    'a negative total was accepted',
  )
  assert.equal(
    await sqlState(db, 'INSERT INTO orders (customer_id, total_cents) VALUES (2, 0)'),
    null,
    'a zero total should still be allowed',
  )
})

test('no statement blocked writes to orders or customers while it scanned them', () => {
  assert.deepEqual(ctx.probe.violations, [], `\n${describe(ctx.probe.violations)}`)
})

test('the whole migration history still applies to an empty database', async () => {
  const applied = await applyToEmptyDatabase()
  assert.ok(applied.length > ORIGINAL.length)
})
