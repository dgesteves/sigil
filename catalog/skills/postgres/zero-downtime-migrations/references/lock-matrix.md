# Lock, scan and rewrite behaviour per statement

Measured on PostgreSQL 18.6 against a table with existing rows. Each statement ran inside
`BEGIN ... COMMIT`, and three things were read afterwards in the same transaction:
`pg_locks` for this backend, `pg_stat_get_xact_tuples_returned` and `_fetched` for the rows read, and
`pg_class.relfilenode` (a change means the heap was rewritten). Lock names are the `pg_locks.mode`
values.

"Blocks writes" means the strongest lock conflicts with `ROW EXCLUSIVE`, the lock INSERT, UPDATE and
DELETE take. "Blocks reads" means it conflicts with `ACCESS SHARE`.

## Indexes

| Statement | Lock on table | Work | Blocks writes | Blocks reads |
| --- | --- | --- | --- | --- |
| `CREATE INDEX` | `SHARE` | full scan + build | yes, whole build | no |
| `CREATE INDEX CONCURRENTLY` | `SHARE UPDATE EXCLUSIVE` | two scans, waits for older transactions | no | no |
| `CREATE UNIQUE INDEX CONCURRENTLY` | `SHARE UPDATE EXCLUSIVE` | as above; fails on duplicates, leaving an INVALID index | no | no |
| `DROP INDEX` | `ACCESS EXCLUSIVE` | catalog | yes (briefly, but queues) | yes |
| `DROP INDEX CONCURRENTLY` | waits for conflicting transactions | catalog | no | no |
| `REINDEX INDEX` | locks out writes on the table; `ACCESS EXCLUSIVE` on the index | full rebuild | yes | reads that use that index |
| `REINDEX INDEX CONCURRENTLY` | `SHARE UPDATE EXCLUSIVE` (session level) | rebuild, then swap | no | no |

`CONCURRENTLY` variants cannot run inside a transaction block, and that includes a multi-statement
simple query. Index lock rows are from the `CREATE INDEX`, `DROP INDEX`, `REINDEX` and explicit-locking
docs. The `CREATE INDEX` row was also measured.

## Constraints

| Statement | Locks | Work | Blocks writes |
| --- | --- | --- | --- |
| `ADD FOREIGN KEY` (validated) | `SHARE ROW EXCLUSIVE` on both tables | scans both tables | **yes**, for the whole scan |
| `ADD FOREIGN KEY ... NOT VALID` | `SHARE ROW EXCLUSIVE` on both tables | catalog | briefly |
| `VALIDATE CONSTRAINT` (FK) | `SHARE UPDATE EXCLUSIVE` on the table, `ROW SHARE` on the referenced table | scans both | no |
| `ADD CHECK` (validated) | `ACCESS EXCLUSIVE` | full scan | **yes**, and blocks reads |
| `ADD CHECK ... NOT VALID` | `ACCESS EXCLUSIVE` | catalog | briefly |
| `VALIDATE CONSTRAINT` (CHECK) | `SHARE UPDATE EXCLUSIVE` | full scan | no |
| `ALTER COLUMN SET NOT NULL`, no proof | `ACCESS EXCLUSIVE` | full scan | **yes**, and blocks reads |
| `SET NOT NULL` with a validated `CHECK (col IS NOT NULL)` | `ACCESS EXCLUSIVE` | none (scan skipped) | briefly |
| `SET NOT NULL` on a column with an invalid not-null constraint | `ACCESS EXCLUSIVE` | full scan (it validates) | **yes** |
| `ADD CONSTRAINT n NOT NULL col NOT VALID` (PG 18) | `ACCESS EXCLUSIVE` | catalog | briefly |
| `VALIDATE CONSTRAINT` (not-null, PG 18) | `SHARE UPDATE EXCLUSIVE` | full scan | no |
| `ADD UNIQUE (col)` | `ACCESS EXCLUSIVE` + `SHARE` | full scan + index build | **yes**, and blocks reads |
| `ADD CONSTRAINT ... UNIQUE USING INDEX` | `ACCESS EXCLUSIVE` | catalog | briefly |
| `ADD PRIMARY KEY USING INDEX`, columns already NOT NULL (docs; measured in the bigint swap recipe) | `ACCESS EXCLUSIVE` | catalog | briefly |
| `ADD PRIMARY KEY USING INDEX`, columns nullable (docs) | `ACCESS EXCLUSIVE` | full scan (implicit SET NOT NULL) | **yes** |

`ADD ... NOT VALID` followed by `VALIDATE` in the **same transaction** behaves like the validated
form. The first statement's lock is still held while the second scans. Measured: a CHECK added
NOT VALID and validated in one transaction scanned every row while holding `ACCESS EXCLUSIVE`.

## Columns

| Statement | Rewrite? | Notes |
| --- | --- | --- |
| `ADD COLUMN c t` (no default) | no | catalog |
| `ADD COLUMN c t DEFAULT <constant>` / `NOT NULL DEFAULT <constant>` | no | value stored in the catalog (PG 11+) |
| `ADD COLUMN c timestamptz DEFAULT now()` | no | `now()` is stable, evaluated once |
| `ADD COLUMN c uuid DEFAULT gen_random_uuid()` | **yes** | volatile default |
| `ADD COLUMN c uuid DEFAULT uuidv7()` | **yes** | volatile (PG 18 function) |
| `ADD COLUMN c timestamptz DEFAULT clock_timestamp()` | **yes** | volatile |
| `ADD COLUMN c bigserial` / `GENERATED ... AS IDENTITY` | **yes** | sequence default per row |
| `ADD COLUMN c int GENERATED ALWAYS AS (...) STORED` | **yes** | |
| `ADD COLUMN c int GENERATED ALWAYS AS (...) VIRTUAL` | no | virtual is the PG 18 default |
| `ALTER COLUMN c SET DEFAULT <anything>` | no | affects future inserts only |
| `DROP COLUMN` | no | the column is hidden. Space is reclaimed on later rewrites |
| `ALTER TYPE varchar(50)` → `varchar(100)` | no | |
| `ALTER TYPE varchar(100)` → `varchar(60)` | **yes** | |
| `ALTER TYPE varchar(n)` → `text` | no | |
| `ALTER TYPE text` → `varchar(n)` | **yes** | |
| `ALTER TYPE numeric(10,2)` → `numeric(12,2)` | no | |
| `ALTER TYPE numeric(12,2)` → `numeric(12,4)` | **yes** | scale change |
| `ALTER TYPE int` → `bigint` | **yes** | |
| `ALTER TYPE timestamp` ↔ `timestamptz` with session `TimeZone = 'UTC'` | no | |
| `ALTER TYPE timestamp` → `timestamptz` with another `TimeZone` | **yes** | |

Every rewrite holds `ACCESS EXCLUSIVE` for the whole rewrite and rebuilds the table's indexes.

## DML

| Statement | Table lock | Row locks |
| --- | --- | --- |
| `UPDATE` / `DELETE` | `ROW EXCLUSIVE` | every touched row, until the transaction commits |
| `UPDATE` in the same transaction as an earlier `ALTER TABLE` | `ACCESS EXCLUSIVE` (from the ALTER) | as above |

A backfill holds its row locks until commit. Application updates to those rows wait for it, so
batch it and commit each batch.
