# events-export

Turns the collector's product-analytics events (`fixtures/events.csv` is a small sample) into
the three tables the warehouse loader ingests every night:

| Function | Table | Notes |
| --- | --- | --- |
| `to_warehouse_rows` | `events` | one row per event, epoch-millisecond timestamps, UTC hour bucket |
| `session_table` | `sessions` | one row per session with start/end in epoch ms and duration in whole seconds |
| `plan_summary` | `plan_daily` | one row per plan, zeros for plans without events |

The loader is strict about column names, order, integer types and values. It rejects a file
whose `event_ms` is not epoch milliseconds or whose `plan_daily` table is missing a plan.

## Development

```sh
python -m venv .venv
.venv/bin/pip install --require-hashes --no-deps -r requirements.lock
.venv/bin/python -m pytest
```

`requirements.lock` is generated from `pyproject.toml` with
`uv pip compile pyproject.toml --group dev --generate-hashes --universal --python-version 3.14 -o requirements.lock`.
