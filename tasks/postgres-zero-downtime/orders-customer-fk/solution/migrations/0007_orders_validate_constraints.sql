-- Step 3 of 3, in a later transaction than the ADD: VALIDATE CONSTRAINT scans the table under
-- SHARE UPDATE EXCLUSIVE (plus ROW SHARE on customers for the foreign key), which does not block
-- reads or writes. Validating in the same transaction as the ADD would hold the ADD's locks
-- for the whole scan.
ALTER TABLE orders VALIDATE CONSTRAINT orders_customer_id_fkey;
ALTER TABLE orders VALIDATE CONSTRAINT orders_total_cents_nonnegative;
