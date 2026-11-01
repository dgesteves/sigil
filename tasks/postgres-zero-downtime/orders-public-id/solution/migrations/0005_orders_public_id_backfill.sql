-- migrate:no-transaction
-- Backfill in short transactions. One UPDATE over 80M rows would hold a row lock on every order
-- until it committed, stalling every status update. Walk the primary key in fixed ranges and COMMIT
-- after each batch (allowed in a DO block that is not inside a transaction block).
-- Orders inserted from now on already get a value from the column default.
DO $$
DECLARE
  batch constant bigint := 5000;
  next_id bigint := 0;
  last_id bigint;
BEGIN
  SELECT coalesce(max(id), 0) INTO last_id FROM orders;
  WHILE next_id <= last_id LOOP
    UPDATE orders
    SET public_id = gen_random_uuid()
    WHERE id >= next_id AND id < next_id + batch AND public_id IS NULL;
    next_id := next_id + batch;
    COMMIT;
  END LOOP;
END
$$;
