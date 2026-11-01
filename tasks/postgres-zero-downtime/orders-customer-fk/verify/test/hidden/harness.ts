// Hidden verifier harness.
//
// 1. Applies the migrations that already ran in production to a fresh Postgres 18 (PGlite).
// 2. Seeds production-shaped data.
// 3. Applies the new migrations through the repo's own runner, with a probe in place of the
//    database client. After every statement the probe records, for each hot table, which locks the
//    current transaction holds on it, how many of its rows the statement read, and whether the
//    table's storage was rewritten.
//
// A statement blocks writes for its whole duration when it reads a large share of a hot table
// while its transaction holds a lock that conflicts with ROW EXCLUSIVE (the lock INSERT, UPDATE and
// DELETE take). That covers non-concurrent index builds, constraints validated in the same
// transaction that added them, SET NOT NULL without a proof, and backfills that run after DDL in one
// transaction. Brief catalog-only DDL under a strong lock is fine and is not flagged.
import { copyFile, mkdtemp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { migrate, type Queryable } from '../../src/migrate.ts'

/** Table lock modes that conflict with ROW EXCLUSIVE, i.e. block INSERT/UPDATE/DELETE. */
const WRITE_BLOCKING = new Set([
  'ShareLock',
  'ShareRowExclusiveLock',
  'ExclusiveLock',
  'AccessExclusiveLock',
])
/** Share of a table's rows that counts as "scanned the table". Index lookups stay far below it. */
const SCAN_SHARE = 0.25
const TX_CONTROL = /^(begin|start\s+transaction|commit|end|rollback|abort)\b/i

export interface Violation {
  statement: string
  table: string
  problem: string
}

interface TableState {
  filenode: string
  locks: string[]
  rowsRead: number
}

function stripLeadingComments(sql: string): string {
  let s = sql.trimStart()
  for (;;) {
    if (s.startsWith('--')) s = s.slice(s.indexOf('\n') + 1 || s.length).trimStart()
    else if (s.startsWith('/*')) s = s.slice(s.indexOf('*/') + 2).trimStart()
    else return s
  }
}

const short = (sql: string) => sql.replace(/\s+/g, ' ').trim().slice(0, 160)

export class LockProbe implements Queryable {
  readonly violations: Violation[] = []
  readonly statements: string[] = []
  #db: PGlite
  #rows: Map<string, number>
  #inTransaction = false

  constructor(db: PGlite, rowsPerTable: Map<string, number>) {
    this.#db = db
    this.#rows = rowsPerTable
  }

  async query(sql: string, params?: unknown[]) {
    const control = TX_CONTROL.exec(stripLeadingComments(sql))?.[1]?.toLowerCase()
    if (control) {
      const result = await this.#db.query(sql, params)
      this.#inTransaction = control === 'begin' || control.startsWith('start')
      return result as { rows: Record<string, unknown>[] }
    }
    this.statements.push(sql)
    if (this.#inTransaction) return this.#measured(sql, params)

    // Autocommit statement: run it in a transaction of our own so its locks can be inspected
    // before they are released. Semantics are the same as running it bare.
    await this.#db.query('BEGIN')
    try {
      const result = await this.#measured(sql, params)
      await this.#db.query('COMMIT')
      return result
    } catch (error) {
      await this.#db.query('ROLLBACK')
      const code = (error as { code?: string }).code
      // 25001: cannot run inside a transaction block (CREATE INDEX CONCURRENTLY, VACUUM, ...).
      // 2D000: invalid transaction termination (DO blocks and procedures that COMMIT).
      if (code !== '25001' && code !== '2D000') throw error
    }
    const before = await this.#snapshot()
    const result = await this.#db.query(sql, params)
    this.#compare(sql, before, await this.#snapshot(), false)
    return result as { rows: Record<string, unknown>[] }
  }

  async #measured(sql: string, params?: unknown[]) {
    const before = await this.#snapshot()
    const result = await this.#db.query(sql, params)
    this.#compare(sql, before, await this.#snapshot(), true)
    return result as { rows: Record<string, unknown>[] }
  }

  #compare(
    sql: string,
    before: Map<string, TableState>,
    after: Map<string, TableState>,
    measured: boolean,
  ) {
    for (const [table, total] of this.#rows) {
      const a = before.get(table)
      const b = after.get(table)
      if (!a || !b) {
        this.violations.push({ statement: short(sql), table, problem: 'dropped or renamed the table' })
        continue
      }
      if (a.filenode !== b.filenode) {
        this.violations.push({
          statement: short(sql),
          table,
          problem: 'rewrote the whole table under an ACCESS EXCLUSIVE lock',
        })
        continue
      }
      if (!measured) continue
      const read = b.rowsRead - a.rowsRead
      const blocking = b.locks.filter((mode) => WRITE_BLOCKING.has(mode))
      if (blocking.length > 0 && read >= total * SCAN_SHARE) {
        this.violations.push({
          statement: short(sql),
          table,
          problem: `read ${read} of ${total} rows while the transaction held ${blocking.join(', ')}, blocking writes`,
        })
      }
    }
  }

  async #snapshot(): Promise<Map<string, TableState>> {
    const { rows } = await this.#db.query<{
      relname: string
      filenode: string
      locks: string
      rows_read: string
    }>(
      `SELECT c.relname,
              c.relfilenode::text AS filenode,
              coalesce((SELECT string_agg(l.mode, ',') FROM pg_locks l
                        WHERE l.locktype = 'relation' AND l.relation = c.oid
                          AND l.pid = pg_backend_pid() AND l.granted), '') AS locks,
              (pg_stat_get_xact_tuples_returned(c.oid) + pg_stat_get_xact_tuples_fetched(c.oid)
               + coalesce((SELECT sum(pg_stat_get_xact_tuples_returned(i.indexrelid))
                           FROM pg_index i WHERE i.indrelid = c.oid), 0))::text AS rows_read
       FROM pg_class c
       WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND c.relname = ANY($1)`,
      [[...this.#rows.keys()]],
    )
    return new Map(
      rows.map((r) => [
        r.relname,
        {
          filenode: r.filenode,
          locks: r.locks ? r.locks.split(',') : [],
          rowsRead: Number(r.rows_read),
        },
      ]),
    )
  }
}

export interface Prepared {
  db: PGlite
  probe: LockProbe
  applied: string[]
}

/**
 * Builds the production-shaped database and applies the new migrations through the probe.
 * `snapshot` names columns of `orders` to copy into verify_orders_before for later comparison.
 */
export async function prepare(options: {
  original: string[]
  seed: string
  hot: string[]
  snapshot?: string[]
}): Promise<Prepared> {
  const db = new PGlite()
  const base = await mkdtemp(join(tmpdir(), 'applied-migrations-'))
  for (const file of options.original) await copyFile(join('migrations', file), join(base, file))
  await migrate(db, base)
  await db.exec(options.seed)
  if (options.snapshot) {
    await db.exec(
      `CREATE TABLE verify_orders_before AS SELECT ${options.snapshot.join(', ')} FROM orders`,
    )
  }
  await db.exec('ANALYZE')
  const rows = new Map<string, number>()
  for (const table of options.hot) {
    const { rows: r } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`)
    rows.set(table, r[0]!.n)
  }
  const probe = new LockProbe(db, rows)
  const applied = await migrate(probe, 'migrations')
  return { db, probe, applied }
}

/** Every migration file, old and new, must still apply cleanly to an empty database. */
export async function applyToEmptyDatabase(): Promise<string[]> {
  const db = new PGlite()
  try {
    return await migrate(db, 'migrations')
  } finally {
    await db.close()
  }
}

export async function newMigrationFiles(original: string[]): Promise<string[]> {
  return (await readdir('migrations')).filter((f) => f.endsWith('.sql') && !original.includes(f))
}

export function describe(violations: Violation[]): string {
  return violations.map((v) => `- ${v.table}: ${v.problem}\n    in: ${v.statement}`).join('\n')
}

/** Runs `sql` and returns the SQLSTATE it fails with, or null when it succeeds. */
export async function sqlState(db: PGlite, sql: string, params?: unknown[]): Promise<string | null> {
  try {
    await db.query(sql, params)
    return null
  } catch (error) {
    return (error as { code?: string }).code ?? 'unknown'
  }
}
