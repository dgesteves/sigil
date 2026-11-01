-- Orders whose customer was erased (GDPR requests) are re-pointed at this row instead of being deleted.
INSERT INTO customers (email, name) VALUES ('deleted-customer@internal.invalid', 'Deleted customer');
