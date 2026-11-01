-- In a later transaction: VALIDATE scans under SHARE UPDATE EXCLUSIVE, which does not block reads
-- or writes. Once it succeeds the column is NOT NULL in the catalog.
ALTER TABLE orders VALIDATE CONSTRAINT orders_public_id_not_null;
