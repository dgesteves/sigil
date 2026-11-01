-- migrate:no-transaction
-- Build the unique index without blocking writes. Drop any INVALID leftover from a failed earlier
-- attempt first: CREATE INDEX CONCURRENTLY IF NOT EXISTS would silently keep it.
DROP INDEX CONCURRENTLY IF EXISTS orders_public_id_key;
CREATE UNIQUE INDEX CONCURRENTLY orders_public_id_key ON orders (public_id);
