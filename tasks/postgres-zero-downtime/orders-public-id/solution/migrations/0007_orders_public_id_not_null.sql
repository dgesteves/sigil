-- PostgreSQL 18: a NOT NULL constraint can be added NOT VALID. It applies to new rows at once and
-- skips the full-table check, so the ACCESS EXCLUSIVE lock is held only for a catalog update.
-- (SET NOT NULL on its own would scan all of orders while holding that lock.)
SET LOCAL lock_timeout = '5s';

ALTER TABLE orders ADD CONSTRAINT orders_public_id_not_null NOT NULL public_id NOT VALID;
