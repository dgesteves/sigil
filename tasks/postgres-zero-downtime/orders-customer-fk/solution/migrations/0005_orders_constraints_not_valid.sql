-- Step 1 of 3. NOT VALID makes both constraints apply to new and updated rows immediately but skips
-- the scan of existing rows, so the strong locks these ALTERs take are held only for a moment.
-- lock_timeout makes the ALTERs give up instead of queueing behind a long transaction, because a
-- queued ACCESS EXCLUSIVE request blocks every query that arrives after it.
SET LOCAL lock_timeout = '5s';

ALTER TABLE orders
  ADD CONSTRAINT orders_customer_id_fkey
  FOREIGN KEY (customer_id) REFERENCES customers (id) NOT VALID;

ALTER TABLE orders
  ADD CONSTRAINT orders_total_cents_nonnegative CHECK (total_cents >= 0) NOT VALID;
