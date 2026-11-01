# Migration runners and transactions

Two questions decide whether a "safe" migration is actually safe:

1. Does the runner wrap each file in a transaction, or the **whole batch** in one?
2. How do you run a statement outside a transaction, and does that path send one statement per
   round trip?

If the whole batch shares a transaction, putting `VALIDATE CONSTRAINT` in a later file does
nothing. If the no-transaction path sends the file as one multi-statement string, Postgres runs it in
an implicit transaction block and `CREATE INDEX CONCURRENTLY` fails.

## Tools

These were checked against current documentation or the published package source (November 2026).

**node-pg-migrate**
- Each migration runs in a transaction. The CLI default is `--single-transaction`: all migrations of
  a run share one transaction. Pass `--no-single-transaction` to commit between migrations.
- `pgm.noTransaction()` in a migration disables its transaction. Under single-transaction mode it
  "also breaks the shared transaction": changes committed before or during it cannot be rolled back.

**drizzle-orm** (the `drizzle-orm/<driver>/migrator` module, 0.45.x)
- Runs **all pending migrations in one transaction** (`session.transaction(...)` around the loop in
  `pg-core/dialect.js`). Statements are split on `--> statement-breakpoint`.
- So `CREATE INDEX CONCURRENTLY` cannot go through it, and NOT VALID plus VALIDATE in separate
  migration files still share one transaction. Run those steps separately, for example with a
  one-off script that sends each statement on its own connection call. Or check whether your
  drizzle-kit version offers a per-migration opt-out.

**dbmate**
- Each migration runs in a transaction when the database supports it.
- `-- migrate:up transaction:false` (and the same on `-- migrate:down`) runs it without one.

**graphile-migrate**
- `--! no-transaction` at the top of the file disables the wrapping transaction.
- Such a file must contain exactly one statement, because `pg` runs multi-statement queries in a
  pseudo-transaction.

**Django** (6.x)
- `django.contrib.postgres.operations.AddIndexConcurrently` / `RemoveIndexConcurrently`. `CONCURRENTLY`
  is not supported inside a transaction, so the migration must be non-atomic (`atomic = False`).
- `AddConstraintNotValid` and `ValidateConstraint`: the docs say to put them in **two separate
  migrations**. In one atomic migration they behave like `AddConstraint`. In one non-atomic
  migration a failed validation can leave the schema half-applied.

**Rails / Active Record** (8.1)
- Each migration is wrapped in a transaction on databases with transactional DDL. Turn it off per
  migration with `disable_ddl_transaction!`.
- `add_index ..., algorithm: :concurrently` needs that, since a concurrent index cannot be added in a
  transaction.
- `add_foreign_key ..., validate: false` and `add_check_constraint ..., validate: false` (PostgreSQL
  only), then `validate_foreign_key` / `validate_check_constraint` in a later migration.

**Prisma Migrate**
- Not covered here: its transaction behaviour for hand-edited SQL could not be confirmed from
  official documentation. Before relying on it, test `CREATE INDEX CONCURRENTLY` in a migration
  against a scratch database with the version you use.

**Anything else, or a custom runner**
- Read the code. Find where it opens a transaction, and whether that happens per file or per run.
- Find the opt-out directive. Check whether the no-transaction path splits the file into statements
  (with a real parser: dollar quotes and comments contain semicolons) or sends it as one string.
- Check what happens when a no-transaction file fails halfway. Usually the earlier statements stay
  applied and the file is not recorded, so every statement must be safe to run twice.

## Session state in no-transaction files

`SET` outside a transaction lasts for the session. A runner applies many files over one connection,
so a `SET lock_timeout` in one file applies to every later file in that run. `SET LOCAL` outside a
transaction block "emits a warning and otherwise has no effect". Use `SET LOCAL` inside
transactional files, and `SET` plus `RESET` in no-transaction files.
