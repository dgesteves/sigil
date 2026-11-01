# orders-service

Order API for the shop: customers, orders and order history. Node 24 runs the TypeScript directly;
the database is PostgreSQL 18.

## Commands

```sh
npm test          # test/*.test.ts against an in-memory Postgres 18 (PGlite)
npm run migrate   # applies pending migrations to the local dev database in .pglite/
```

## Database

Production is a managed PostgreSQL 18 cluster. `orders` has about 80 million rows and takes writes
all day: checkout inserts, plus status updates from payments and fulfilment. `customers` has about
6 million rows.

Deploys run `npm run migrate` against production before the new code starts. That is the only hook
we have: there is no separate job runner for one-off scripts.

### Migrations

- Files in `migrations/` run in lexical order. Name new ones `NNNN_description.sql` with the next number.
- Each file runs in a single transaction. If the first line of a file is `-- migrate:no-transaction`,
  each statement in it runs on its own instead, outside a transaction block.
- Applied files are recorded in `schema_migrations`. Everything in `migrations/` on main has already
  run in production: never edit an applied migration, add a new one.
- `src/migrate.ts` is vendored from the platform repo. Change it there, not here.
