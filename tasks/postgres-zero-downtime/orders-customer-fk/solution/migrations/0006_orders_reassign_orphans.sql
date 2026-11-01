-- Step 2 of 3, in its own transaction: no table-level lock beyond ROW EXCLUSIVE, and only the few
-- orphaned rows are locked.
UPDATE orders o
SET customer_id = (SELECT id FROM customers WHERE email = 'deleted-customer@internal.invalid'),
    updated_at = now()
WHERE NOT EXISTS (SELECT 1 FROM customers c WHERE c.id = o.customer_id);
