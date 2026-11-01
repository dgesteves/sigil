// Vendored from the platform repo (platform/db/migrate.ts). Change it there, not here.
//
// Applies migrations/*.sql in lexical order and records each file in schema_migrations.
// A file runs inside one transaction unless its first line is `-- migrate:no-transaction`,
// in which case every statement runs on its own, outside any transaction block.
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse } from 'libpg-query'

export interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>
}

const NO_TRANSACTION = /^\s*--\s*migrate:no-transaction\b/

/** Splits a SQL script into statements with the real Postgres parser (dollar quotes, comments). */
export async function splitStatements(sql: string): Promise<string[]> {
  const { stmts = [] } = await parse(sql)
  const bytes = Buffer.from(sql, 'utf8')
  return stmts
    .map((s) => {
      const start = s.stmt_location ?? 0
      const end = s.stmt_len ? start + s.stmt_len : bytes.length
      return bytes.subarray(start, end).toString('utf8').trim()
    })
    .filter((s) => s.length > 0)
}

export async function migrate(
  db: Queryable,
  dir = 'migrations',
  log: (line: string) => void = () => {},
): Promise<string[]> {
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`)
  const done = new Set(
    (await db.query('SELECT filename FROM schema_migrations')).rows.map((r) => String(r.filename)),
  )
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()
  const applied: string[] = []

  for (const file of files) {
    if (done.has(file)) continue
    const sql = await readFile(join(dir, file), 'utf8')
    const statements = await splitStatements(sql)

    if (NO_TRANSACTION.test(sql)) {
      for (const statement of statements) await db.query(statement)
      await db.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file])
    } else {
      await db.query('BEGIN')
      try {
        for (const statement of statements) await db.query(statement)
        await db.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file])
        await db.query('COMMIT')
      } catch (error) {
        await db.query('ROLLBACK')
        throw new Error(`${file}: ${(error as Error).message}`, { cause: error })
      }
    }
    log(`applied ${file}`)
    applied.push(file)
  }
  return applied
}
