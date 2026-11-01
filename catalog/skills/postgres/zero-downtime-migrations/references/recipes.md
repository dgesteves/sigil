# Recipes

Each step heading says whether it must run inside a transaction or outside one ("no-tx": your
runner's opt-out, one statement per call). Steps are separate transactions unless a heading says
otherwise. Every recipe below was run on PostgreSQL 18.6, with locks and rewrites measured as in
[lock-matrix.md](lock-matrix.md).

## Add an index

```sql
-- no-tx
DROP INDEX CONCURRENTLY IF EXISTS shipments_carrier_dispatched_idx;  -- clears an INVALID leftover
CREATE INDEX CONCURRENTLY shipments_carrier_dispatched_idx
  ON shipments (carrier_id, dispatched_at DESC);
```

Then confirm `SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;` returns nothing.

- On a retry after a failure, the `DROP` is what saves you. `CREATE INDEX CONCURRENTLY IF NOT EXISTS`
  sees the invalid index by name, prints "already exists, skipping" and leaves it invalid.
- A dropped-and-rebuilt index that was actually valid (the build succeeded, then the runner crashed
  before recording the file) costs one more build, not an outage.
- Equality columns go first, then range or `ORDER BY` columns. `INCLUDE (...)` can turn the query
  into an index-only scan.

## Index on a partitioned table

`CREATE INDEX CONCURRENTLY` on the partitioned parent fails ("cannot create index on partitioned
table ... concurrently"). Build each partition's index concurrently, then attach them to a parent
index created `ON ONLY`. That parent index starts invalid and becomes valid once every partition is
attached.

```sql
-- no-tx, one per partition
CREATE INDEX CONCURRENTLY sales_2025_qty_idx ON sales_2025 (qty);
CREATE INDEX CONCURRENTLY sales_2026_qty_idx ON sales_2026 (qty);
-- tx: catalog-only
CREATE INDEX sales_qty_idx ON ONLY sales (qty);
ALTER INDEX sales_qty_idx ATTACH PARTITION sales_2025_qty_idx;
ALTER INDEX sales_qty_idx ATTACH PARTITION sales_2026_qty_idx;
```

## Foreign key

```sql
-- tx 1
SET LOCAL lock_timeout = '5s';
ALTER TABLE shipments ADD CONSTRAINT shipments_carrier_fk
  FOREIGN KEY (carrier_id) REFERENCES carriers (carrier_id) NOT VALID;
-- tx 2 (optional): repair existing rows that would fail validation
-- tx 3
ALTER TABLE shipments VALIDATE CONSTRAINT shipments_carrier_fk;
```

- Adding it `NOT VALID` first means no new violating rows can appear while you repair old ones.
- An index on the referencing column (`shipments.carrier_id`) is not required, but without one every
  `DELETE` or key update on `carriers` scans `shipments`. Build it concurrently first if deletes happen.
- `ON DELETE` behaviour: `NO ACTION` (the default) raises SQLSTATE 23503, `RESTRICT` raises 23001.
  `CASCADE` deletes child rows, so decide deliberately.
- PG 18 also allows `NOT VALID` foreign keys on partitioned tables.

## CHECK constraint

```sql
-- tx 1
SET LOCAL lock_timeout = '5s';
ALTER TABLE shipments ADD CONSTRAINT shipments_fee_minor_check CHECK (fee_minor >= 0) NOT VALID;
-- tx 2
ALTER TABLE shipments VALIDATE CONSTRAINT shipments_fee_minor_check;
```

## NOT NULL

PostgreSQL 18:

```sql
-- tx 1
SET LOCAL lock_timeout = '5s';
ALTER TABLE shipments ADD CONSTRAINT shipments_tracking_code_nn NOT NULL tracking_code NOT VALID;
-- tx 2
ALTER TABLE shipments VALIDATE CONSTRAINT shipments_tracking_code_nn;
```

PostgreSQL 12-17:

```sql
-- tx 1
SET LOCAL lock_timeout = '5s';
ALTER TABLE shipments ADD CONSTRAINT shipments_tracking_code_present
  CHECK (tracking_code IS NOT NULL) NOT VALID;
-- tx 2
ALTER TABLE shipments VALIDATE CONSTRAINT shipments_tracking_code_present;
-- tx 3: the validated CHECK lets SET NOT NULL skip its scan
SET LOCAL lock_timeout = '5s';
ALTER TABLE shipments ALTER COLUMN tracking_code SET NOT NULL;
ALTER TABLE shipments DROP CONSTRAINT shipments_tracking_code_present;
```

## Unique constraint or primary key

```sql
-- no-tx
CREATE UNIQUE INDEX CONCURRENTLY shipments_tracking_code_uniq ON shipments (tracking_code);
-- tx
SET LOCAL lock_timeout = '5s';
ALTER TABLE shipments ADD CONSTRAINT shipments_tracking_code_uniq
  UNIQUE USING INDEX shipments_tracking_code_uniq;
```

- The index must be a plain b-tree with default sort order, no expressions and no `WHERE`. Otherwise
  keep it as a unique index without a constraint.
- For `PRIMARY KEY USING INDEX`, make the columns NOT NULL first (recipe above). Otherwise the ALTER
  runs an implicit `SET NOT NULL` scan under `ACCESS EXCLUSIVE`.
- Find duplicates before building:
  `SELECT tracking_code, count(*) FROM shipments GROUP BY 1 HAVING count(*) > 1`.

## New column with a generated value for every row

```sql
-- tx 1: catalog-only
SET LOCAL lock_timeout = '5s';
ALTER TABLE shipments ADD COLUMN tracking_code uuid;
ALTER TABLE shipments ALTER COLUMN tracking_code SET DEFAULT gen_random_uuid();

-- no-tx: batched backfill (see below)

-- no-tx
DROP INDEX CONCURRENTLY IF EXISTS shipments_tracking_code_uniq;
CREATE UNIQUE INDEX CONCURRENTLY shipments_tracking_code_uniq ON shipments (tracking_code);

-- then the NOT NULL recipe
```

## Batched backfill

From a migration, outside a transaction block:

```sql
DO $$
DECLARE
  chunk constant bigint := 5000;
  lower_key bigint := 0;
  upper_bound bigint;
BEGIN
  SELECT coalesce(max(shipment_id), 0) INTO upper_bound FROM shipments;
  WHILE lower_key <= upper_bound LOOP
    UPDATE shipments SET tracking_code = gen_random_uuid()
    WHERE shipment_id >= lower_key AND shipment_id < lower_key + chunk AND tracking_code IS NULL;
    lower_key := lower_key + chunk;
    COMMIT;
  END LOOP;
END
$$;
```

Or as a procedure, which can be created in a normal transactional migration and called from a
no-tx one:

```sql
CREATE PROCEDURE fill_tracking_codes(step int DEFAULT 10000)
LANGUAGE plpgsql AS $$
DECLARE touched int;
BEGIN
  LOOP
    UPDATE shipments SET tracking_code = gen_random_uuid()
    WHERE shipment_id IN (SELECT shipment_id FROM shipments WHERE tracking_code IS NULL
                          ORDER BY shipment_id LIMIT step);
    GET DIAGNOSTICS touched = ROW_COUNT;
    EXIT WHEN touched = 0;
    COMMIT;
  END LOOP;
END $$;
-- no-tx
CALL fill_tracking_codes(10000);
DROP PROCEDURE fill_tracking_codes(int);
```

- `COMMIT` inside `DO`/`CALL` only works when the call is not inside a transaction block. Otherwise
  it fails with `invalid transaction termination` (SQLSTATE 2D000).
- Prefer key ranges (first form). The `IS NULL ... LIMIT` form rescans from the start of the table
  every batch unless an index on the predicate exists.
- With hot standbys, check replication lag between batches; `pg_sleep` in the loop throttles it.
- Huge tables: run the backfill as a resumable background job instead of a deploy-time migration,
  and gate the later NOT NULL step on it finishing.

## Change a column type that would rewrite (int → bigint key)

The expand/contract version. Shown for a `serial` primary key with no foreign keys pointing at it.
If other tables reference it, drop and re-add those FKs as `NOT VALID` + `VALIDATE` around the swap.

```sql
-- tx 1: expand, plus a trigger so new and updated rows carry the new column
SET LOCAL lock_timeout = '5s';
ALTER TABLE events ADD COLUMN event_id_wide bigint;
CREATE FUNCTION events_copy_event_id() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.event_id_wide := NEW.event_id; RETURN NEW; END $$;
CREATE TRIGGER events_copy_event_id BEFORE INSERT OR UPDATE ON events
  FOR EACH ROW EXECUTE FUNCTION events_copy_event_id();

-- no-tx: batched backfill of event_id_wide = event_id (as above)
-- no-tx
CREATE UNIQUE INDEX CONCURRENTLY events_event_id_wide_key ON events (event_id_wide);
-- NOT NULL on event_id_wide via NOT VALID + VALIDATE (PG 18) or the CHECK route

-- tx: the swap, catalog-only (measured: no scan, no rewrite)
SET LOCAL lock_timeout = '5s';
ALTER TABLE events DROP CONSTRAINT events_pkey;
ALTER TABLE events ADD CONSTRAINT events_pkey PRIMARY KEY USING INDEX events_event_id_wide_key;
ALTER TABLE events RENAME COLUMN event_id TO event_id_old;
ALTER TABLE events RENAME COLUMN event_id_wide TO event_id;
ALTER SEQUENCE events_event_id_seq OWNED BY events.event_id;
ALTER TABLE events ALTER COLUMN event_id SET DEFAULT nextval('events_event_id_seq');
ALTER TABLE events ALTER COLUMN event_id_old DROP DEFAULT;
ALTER TABLE events ALTER COLUMN event_id_old DROP NOT NULL;
DROP TRIGGER events_copy_event_id ON events;
DROP FUNCTION events_copy_event_id();

-- later deploy, once no code reads event_id_old
ALTER TABLE events DROP COLUMN event_id_old;
```

## Rename a column

`RENAME COLUMN` itself is instant, but any running process that still uses the old name fails. Over
two or more deploys:

1. Add the new column (catalog-only), and keep both in sync, either with a trigger or by writing both
   from the app.
2. Backfill the new column in batches.
3. Deploy code that reads and writes the new column only.
4. Drop the trigger and the old column.

If the old name only needs to survive one deploy and the table is not written through it, an
updatable view with the old column name can bridge it instead.

## Drop a column

`DROP COLUMN` is catalog-only, but do it in the deploy *after* the code stopped referencing the
column. ORMs that cache column lists, or that select `*` into strict structs, break when a column
disappears underneath them. Most ORMs have a way to ignore a column for that first deploy.

## Change a default

`ALTER COLUMN ... SET DEFAULT` and `DROP DEFAULT` are catalog-only and affect future inserts only,
for volatile defaults too. They still take `ACCESS EXCLUSIVE`, so use `lock_timeout`.
