-- customer_id has no foreign key: orders were bulk-imported from the old shop before customers was clean.
CREATE TABLE orders (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id bigint NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  total_cents integer NOT NULL,
  currency text NOT NULL DEFAULT 'EUR',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX orders_created_at_idx ON orders (created_at);
