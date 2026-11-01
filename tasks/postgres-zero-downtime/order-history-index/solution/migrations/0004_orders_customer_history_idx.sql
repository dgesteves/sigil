-- migrate:no-transaction
-- orders takes writes all day. A plain CREATE INDEX holds a SHARE lock that blocks every insert
-- and update for the whole build, so build it concurrently, which also means outside a transaction.
-- Drop first: a failed concurrent build leaves an INVALID index that IF NOT EXISTS would keep.
DROP INDEX CONCURRENTLY IF EXISTS orders_customer_id_created_at_idx;
CREATE INDEX CONCURRENTLY orders_customer_id_created_at_idx ON orders (customer_id, created_at DESC);
