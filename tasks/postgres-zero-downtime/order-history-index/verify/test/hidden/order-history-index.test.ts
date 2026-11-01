import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { applyToEmptyDatabase, describe, type Prepared, prepare } from './harness.ts'

const ORIGINAL = ['0001_create_customers.sql', '0002_create_orders.sql', '0003_orders_notes.sql']

// 2,000 customers with 50 orders each, spread over two years.
const SEED = `
INSERT INTO customers (email, name)
SELECT 'customer' || g || '@example.com', 'Customer ' || g FROM generate_series(1, 2000) g;

INSERT INTO orders (customer_id, status, total_cents, created_at, updated_at)
SELECT 1 + (g * 7919) % 2000,
       (ARRAY['pending', 'paid', 'shipped', 'delivered'])[1 + g % 4],
       500 + (g * 31) % 20000,
       timestamptz '2024-01-01 00:00:00+00' + g * interval '7 minutes',
       timestamptz '2024-01-01 00:00:00+00' + g * interval '7 minutes'
FROM generate_series(1, 100000) g;`

// The query from src/orders.ts, with literal values so the plan is inspectable.
const HISTORY = `SELECT id, status, total_cents, currency, created_at
  FROM orders WHERE customer_id = 42 ORDER BY created_at DESC LIMIT 20`

let ctx: Prepared

before(async () => {
  ctx = await prepare({ original: ORIGINAL, seed: SEED, hot: ['orders'] })
})

after(async () => {
  await ctx?.db.close()
})

test('a new migration applies on top of the production schema and data', () => {
  assert.ok(ctx.applied.length > 0, 'expected at least one new file in migrations/')
})

test('order history reads the newest rows straight from an index, without a sort', async () => {
  await ctx.db.exec('SET enable_seqscan = off; SET enable_bitmapscan = off;')
  const { rows } = await ctx.db.query<{ 'QUERY PLAN': unknown }>(`EXPLAIN (FORMAT JSON) ${HISTORY}`)
  await ctx.db.exec('RESET enable_seqscan; RESET enable_bitmapscan;')
  const nodes: Record<string, unknown>[] = []
  const walk = (node: Record<string, unknown>) => {
    nodes.push(node)
    for (const child of (node.Plans as Record<string, unknown>[] | undefined) ?? []) walk(child)
  }
  const plan = rows[0]!['QUERY PLAN'] as { Plan: Record<string, unknown> }[]
  walk(plan[0]!.Plan)
  const summary = nodes.map((n) => `${n['Node Type']}${n['Index Name'] ? ` (${n['Index Name']})` : ''}`)
  assert.ok(
    !nodes.some((n) => String(n['Node Type']).includes('Sort')),
    `plan still sorts: ${summary.join(' -> ')}`,
  )
  const scan = nodes.find(
    (n) =>
      (n['Node Type'] === 'Index Scan' || n['Node Type'] === 'Index Only Scan') &&
      n['Relation Name'] === 'orders' &&
      String(n['Index Cond'] ?? '').includes('customer_id'),
  )
  assert.ok(scan, `expected an index scan on orders keyed by customer_id: ${summary.join(' -> ')}`)

  // Equality on the leading column and order on the next one is what lets the scan stop after
  // LIMIT rows. (created_at, customer_id) also avoids the sort but walks most of the index.
  const { rows: keys } = await ctx.db.query<{ attname: string }>(
    `SELECT a.attname
     FROM pg_index i, unnest(i.indkey::int2[]) WITH ORDINALITY AS k(attnum, ord), pg_attribute a
     WHERE i.indexrelid = $1::regclass AND a.attrelid = i.indrelid AND a.attnum = k.attnum
     ORDER BY k.ord`,
    [scan['Index Name']],
  )
  assert.deepEqual(
    keys.slice(0, 2).map((k) => k.attname),
    ['customer_id', 'created_at'],
    `index ${String(scan['Index Name'])} should lead with (customer_id, created_at)`,
  )

  const { rows: newest } = await ctx.db.query<{ id: number }>(HISTORY)
  const { rows: expected } = await ctx.db.query<{ id: number }>(
    `SELECT id FROM orders WHERE customer_id = 42 ORDER BY created_at DESC, id DESC LIMIT 20`,
  )
  assert.deepEqual(
    newest.map((r) => Number(r.id)),
    expected.map((r) => Number(r.id)),
  )
})

test('no statement blocked writes to orders while it scanned or rewrote the table', () => {
  assert.deepEqual(ctx.probe.violations, [], `\n${describe(ctx.probe.violations)}`)
})

test('no invalid index is left behind', async () => {
  const { rows } = await ctx.db.query(
    `SELECT indexrelid::regclass::text AS name FROM pg_index WHERE NOT indisvalid OR NOT indisready`,
  )
  assert.deepEqual(rows, [])
})

test('the whole migration history still applies to an empty database', async () => {
  const applied = await applyToEmptyDatabase()
  assert.ok(applied.length > ORIGINAL.length)
})
