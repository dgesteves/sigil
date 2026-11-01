# orderlog

Analytics over the order event exports that feed the fulfilment dashboard. Built on Polars (lazy API).

```sh
python -m venv .venv && .venv/bin/pip install --require-hashes --no-deps -r requirements.lock
.venv/bin/python -m pytest
```

## Data

`events.csv` (see `data/sample/`): one row per state change of an order.

| column | meaning |
| --- | --- |
| `event_id` | unique id, assigned by whichever producer wrote the event. Ids are **not** in time order across producers. |
| `order_id` | the order the event belongs to |
| `occurred_at` | when it happened, UTC, second precision |
| `status` | the order's status after this event: `created`, `payment_captured`, `packed`, `shipped`, `delivered`, `refund_issued`, `cancelled` |
| `amount_cents` | set only for `payment_captured` (money in) and `refund_issued` (money back to the customer, stored as a positive number) |

Several producers append to the same export, so rows arrive in no particular order. Two events of
the same order can share an `occurred_at` second; when they do, the one with the higher `event_id`
is the later one (producers allocate ids per order monotonically).

`orders.csv`: `order_id`, `customer_id`, `region`. The events export can contain events for orders
that were purged from `orders.csv` (GDPR deletions); those events must be ignored everywhere.

The production files are far too big for memory: functions in this package take and return
`LazyFrame`s and leave collecting to the caller (the dashboard job collects with the default engine
and sinks to Parquet).
