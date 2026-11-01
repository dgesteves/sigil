import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { migrate, splitStatements } from '../src/migrate.ts'

async function dirWith(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'migrations-'))
  for (const [name, sql] of Object.entries(files)) await writeFile(join(dir, name), sql)
  return dir
}

test('splits statements without breaking dollar quotes, strings or comments', async () => {
  const sql = `-- first; still a comment
CREATE TABLE a (id int); /* block ; comment */
DO $$ BEGIN RAISE NOTICE 'x;y'; END $$;
SELECT 'it''s; fine';`
  assert.deepEqual(await splitStatements(sql), [
    'CREATE TABLE a (id int)',
    "DO $$ BEGIN RAISE NOTICE 'x;y'; END $$",
    "SELECT 'it''s; fine'",
  ])
})

test('applies files in lexical order and records them', async () => {
  const db = new PGlite()
  const dir = await dirWith({
    '0002_b.sql': 'ALTER TABLE a ADD COLUMN b int;',
    '0001_a.sql': 'CREATE TABLE a (id int);',
  })
  assert.deepEqual(await migrate(db, dir), ['0001_a.sql', '0002_b.sql'])
  const { rows } = await db.query('SELECT filename FROM schema_migrations ORDER BY filename')
  assert.deepEqual(
    rows.map((r) => (r as { filename: string }).filename),
    ['0001_a.sql', '0002_b.sql'],
  )
})

test('skips files that were already applied', async () => {
  const db = new PGlite()
  const dir = await dirWith({ '0001_a.sql': 'CREATE TABLE a (id int);' })
  await migrate(db, dir)
  assert.deepEqual(await migrate(db, dir), [])
})

test('rolls back a failing file as a whole', async () => {
  const db = new PGlite()
  const dir = await dirWith({
    '0001_a.sql': 'CREATE TABLE a (id int); INSERT INTO a VALUES (1); SELECT 1 / 0;',
  })
  await assert.rejects(migrate(db, dir), /0001_a\.sql: division by zero/)
  const { rows } = await db.query(`SELECT to_regclass('a') AS t`)
  assert.equal((rows[0] as { t: string | null }).t, null)
})

test('runs a no-transaction file statement by statement', async () => {
  const db = new PGlite()
  const dir = await dirWith({
    '0001_a.sql': 'CREATE TABLE a (id int);',
    // VACUUM refuses to run inside a transaction block.
    '0002_vacuum.sql': '-- migrate:no-transaction\nVACUUM ANALYZE a;\nVACUUM a;',
  })
  assert.deepEqual(await migrate(db, dir), ['0001_a.sql', '0002_vacuum.sql'])
})
