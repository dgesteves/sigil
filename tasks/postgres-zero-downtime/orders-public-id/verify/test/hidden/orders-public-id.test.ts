import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { applyToEmptyDatabase, describe, type Prepared, prepare, sqlState } from './harness.ts'

const ORIGINAL = ['0001_create_customers.sql', '0002_create_orders.sql', '0003_orders_notes.sql']
const ROWS = 120_000

const SEED = `
INSERT INTO customers (email, name)
SELECT 'customer' || g || '@example.com', 'Customer ' || g FROM generate_series(1, 2000) g;

INSERT INTO orders (customer_id, status, total_cents, created_at, updated_at)
SELECT 1 + (g * 7919) % 2000,
       (ARRAY['pending', 'paid', 'shipped', 'delivered'])[1 + g % 4],
       500 + (g * 31) % 20000,
       timestamptz '2023-01-01 00:00:00+00' + g * interval '5 minutes',
       timestamptz '2023-01-01 00:00:00+00' + g * interval '5 minutes'
FROM generate_series(1, ${ROWS}) g;`

let ctx: Prepared

before(async () => {
  ctx = await prepare({
    original: ORIGINAL,
    seed: SEED,
    hot: ['orders'],
    snapshot: ['id', 'customer_id', 'total_cents', 'status'],
  })
})

after(async () => {
  await ctx?.db.close()
})

test('new migrations apply on top of the production schema and data', () => {
  assert.ok(ctx.applied.length > 0, 'expected at least one new file in migrations/')
})

test('public_id is a uuid column, NOT NULL, with every constraint on orders validated', async () => {
  const { rows } = await ctx.db.query<{ data_type: string; is_nullable: string }>(
    `SELECT data_type, is_nullable FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'public_id'`,
  )
  assert.equal(rows.length, 1, 'orders.public_id does not exist')
  assert.deepEqual(rows[0], { data_type: 'uuid', is_nullable: 'NO' })
  const { rows: invalid } = await ctx.db.query(
    `SELECT conname FROM pg_constraint WHERE conrelid = 'orders'::regclass AND NOT convalidated`,
  )
  assert.deepEqual(invalid, [], 'a constraint on orders was left NOT VALID')
})

test('every existing order has its own public_id and nothing else changed', async () => {
  const { rows } = await ctx.db.query<{ kept: number; with_id: number; distinct_ids: number }>(
    `SELECT count(*) FILTER (WHERE o.customer_id = b.customer_id AND o.total_cents = b.total_cents
                             AND o.status = b.status)::int AS kept,
            count(o.public_id)::int AS with_id,
            count(DISTINCT o.public_id)::int AS distinct_ids
     FROM verify_orders_before b JOIN orders o USING (id)`,
  )
  assert.deepEqual(rows[0], { kept: ROWS, with_id: ROWS, distinct_ids: ROWS })
})

test('a valid unique index covers exactly public_id', async () => {
  const { rows } = await ctx.db.query(
    `SELECT i.indexrelid::regclass::text AS name
     FROM pg_index i
     WHERE i.indrelid = 'orders'::regclass AND i.indisunique AND i.indisvalid AND i.indisready
       AND i.indpred IS NULL AND i.indexprs IS NULL AND i.indnkeyatts = 1
       AND i.indkey[0] = (SELECT attnum FROM pg_attribute
                           WHERE attrelid = 'orders'::regclass AND attname = 'public_id')`,
  )
  assert.equal(rows.length >= 1, true, 'no valid unique index on orders (public_id)')
})

test('new orders get a public_id automatically; duplicates and NULLs are rejected', async () => {
  const { db } = ctx
  const { rows } = await db.query<{ public_id: string }>(
    `INSERT INTO orders (customer_id, total_cents) VALUES (1, 100), (2, 200) RETURNING public_id`,
  )
  assert.equal(rows.length, 2)
  assert.ok(rows[0]!.public_id && rows[1]!.public_id, 'new orders did not get a public_id')
  assert.notEqual(rows[0]!.public_id, rows[1]!.public_id)
  assert.equal(
    await sqlState(db, 'INSERT INTO orders (customer_id, total_cents, public_id) VALUES (3, 300, $1)', [
      rows[0]!.public_id,
    ]),
    '23505',
    'a duplicate public_id was accepted',
  )
  assert.equal(
    await sqlState(db, 'INSERT INTO orders (customer_id, total_cents, public_id) VALUES (3, 300, NULL)'),
    '23502',
    'a NULL public_id was accepted',
  )
})

test('no statement blocked writes to orders while it scanned or rewrote the table', () => {
  assert.deepEqual(ctx.probe.violations, [], `\n${describe(ctx.probe.violations)}`)
})

test('the backfill committed in batches instead of one long transaction', async () => {
  const { rows } = await ctx.db.query<{ transactions: number }>(
    `SELECT count(DISTINCT o.xmin::text)::int AS transactions
     FROM verify_orders_before b JOIN orders o USING (id)`,
  )
  assert.ok(
    rows[0]!.transactions > 1,
    `all ${ROWS} existing orders were written by one transaction, which holds a row lock on every order until it commits`,
  )
})

test('the whole migration history still applies to an empty database', async () => {
  const applied = await applyToEmptyDatabase()
  assert.ok(applied.length > ORIGINAL.length)
})
