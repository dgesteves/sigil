-- Add the column with no default, then set the default in a separate step. Both are catalog-only
-- changes. Adding it as `DEFAULT gen_random_uuid()` in one step would rewrite every row of orders
-- under ACCESS EXCLUSIVE, because the default is volatile. SET DEFAULT applies to new rows only.
SET LOCAL lock_timeout = '5s';

ALTER TABLE orders ADD COLUMN public_id uuid;
ALTER TABLE orders ALTER COLUMN public_id SET DEFAULT gen_random_uuid();
