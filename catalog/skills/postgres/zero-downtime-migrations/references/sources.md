# Sources

Checked in November 2026 against PostgreSQL 18 (18.6), the current major release.

## PostgreSQL documentation

- ALTER TABLE: lock levels, NOT VALID for FK/CHECK/not-null, VALIDATE CONSTRAINT under
  SHARE UPDATE EXCLUSIVE, fast defaults, rewrite rules for ALTER TYPE, USING INDEX restrictions.
  https://www.postgresql.org/docs/current/sql-altertable.html
- CREATE INDEX: CONCURRENTLY, transaction-block restriction, invalid indexes on failure, IF NOT EXISTS
  caveat, partitioned tables, unique builds. https://www.postgresql.org/docs/current/sql-createindex.html
- DROP INDEX CONCURRENTLY restrictions: https://www.postgresql.org/docs/current/sql-dropindex.html
- REINDEX and REINDEX CONCURRENTLY: https://www.postgresql.org/docs/current/sql-reindex.html
- Table-level lock modes and conflicts: https://www.postgresql.org/docs/current/explicit-locking.html
- lock_timeout, statement_timeout, transaction_timeout, idle_in_transaction_session_timeout:
  https://www.postgresql.org/docs/current/runtime-config-client.html
- SET and SET LOCAL scope: https://www.postgresql.org/docs/current/sql-set.html
- Multi-statement simple queries run in an implicit transaction block:
  https://www.postgresql.org/docs/current/protocol-flow.html
- Transaction control in DO blocks and procedures:
  https://www.postgresql.org/docs/current/plpgsql-transactions.html
- Foreign keys: indexing referencing columns, NO ACTION vs RESTRICT:
  https://www.postgresql.org/docs/current/ddl-constraints.html
- SQLSTATE codes (23503, 23001, 23514, 23502, 23505, 25001, 2D000):
  https://www.postgresql.org/docs/current/errcodes-appendix.html
- PostgreSQL 18 release notes (released 2025-09-25): NOT VALID not-null constraints, not-null
  constraints in pg_constraint, uuidv7(), virtual generated columns as the default, NOT ENFORCED
  constraints, NOT VALID foreign keys on partitioned tables.
  https://www.postgresql.org/docs/18/release-18.html
- PostgreSQL 17 release notes: transaction_timeout. https://www.postgresql.org/docs/17/release-17.html

## Migration tools

- node-pg-migrate, transactions and `pgm.noTransaction()`: https://salsita.github.io/node-pg-migrate/migrations/
- node-pg-migrate CLI, `--single-transaction` default `true`: https://salsita.github.io/node-pg-migrate/cli
- dbmate, `transaction:false`: https://github.com/amacneil/dbmate
- graphile-migrate, `--! no-transaction` and the one-statement rule: https://github.com/graphile/migrate
- Django 6.1, PostgreSQL operations: https://docs.djangoproject.com/en/stable/ref/contrib/postgres/operations/
- Rails 8.1, `algorithm: :concurrently`, `validate: false`: https://api.rubyonrails.org/classes/ActiveRecord/ConnectionAdapters/SchemaStatements.html
- Rails 8.1, `validate_foreign_key`, `validate_check_constraint`: https://api.rubyonrails.org/classes/ActiveRecord/ConnectionAdapters/PostgreSQL/SchemaStatements.html
- Rails guides, `disable_ddl_transaction!`: https://guides.rubyonrails.org/active_record_migrations.html
- drizzle-orm 0.45.4: the published package's `pg-core/dialect.js` wraps all pending migrations in
  one `session.transaction` (read from the npm tarball).

## Behaviour reproduced by running it

On the `postgres:18` image (PostgreSQL 18.6):
- A plain SELECT waited 6 s behind an `ALTER TABLE` that was itself waiting for a reader's lock.
  With `SET lock_timeout = '1s'` the ALTER failed with "canceling statement due to lock timeout",
  and the SELECT did not wait.
- `CREATE INDEX CONCURRENTLY` with `lock_timeout = '1s'`, while another transaction had written
  to the table, failed with a lock timeout and left the index with `indisvalid = false`.
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS` then printed "already exists, skipping" and the index
  stayed invalid. `DROP INDEX CONCURRENTLY IF EXISTS` followed by a new build produced a valid
  index.
- `psql -c "SET ...; CREATE INDEX CONCURRENTLY ..."` failed with "cannot run inside a transaction
  block" (one simple query, so one implicit transaction).
- With a NOT VALID not-null constraint, `attnotnull` was already true and
  `information_schema.columns.is_nullable` was already `NO`.

On PGlite 0.5.14 (PostgreSQL 18.6 compiled to WebAssembly), every row of
[lock-matrix.md](lock-matrix.md) marked as measured, the recipes in [recipes.md](recipes.md), and:
- `COMMIT` inside a `DO` block works outside a transaction block and fails with SQLSTATE 2D000
  inside one.
- `pg_stat_get_xact_*` counters include unflushed counts from earlier transactions in the session,
  so measure a statement by the difference before and after it.
