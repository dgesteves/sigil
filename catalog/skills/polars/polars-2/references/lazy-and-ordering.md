# Lazy API, engines and row order

Checked on polars 2.1.0. Ordering experiments were repeated on 1.44.2 and inside `python:3.14-slim`
with the default thread pool and with `POLARS_MAX_THREADS=1`; the results below held in every run.

## Building a lazy pipeline

```python
import polars as pl

tickets = pl.scan_csv(
    "tickets/*.csv",
    schema_overrides={"ticket_id": pl.Int64, "priority": pl.String},
    null_values=["", "NA"],
)
opened = pl.col("opened_at").str.to_datetime("%Y-%m-%d %H:%M:%S", time_zone="UTC")

backlog = (
    tickets.with_columns(opened_at=opened)
    .filter(pl.col("closed_at").is_null())          # pushed into the scan
    .select("ticket_id", "queue", "priority", "opened_at")  # only these columns are read
)

backlog.sink_parquet("backlog.parquet")              # streams; nothing held in memory
summary = backlog.group_by("queue").agg(pl.len().alias("open")).sort("queue").collect()
```

- `scan_*` readers: `scan_csv`, `scan_parquet`, `scan_ndjson`, `scan_ipc`, `scan_iceberg`,
  `scan_delta`. Globs and lists of paths are fine; `include_file_paths="src"` adds the source path.
- `collect()` runs the plan; `collect_batches()` iterates over DataFrames; `sink_parquet` /
  `sink_csv` / `sink_ndjson` / `sink_ipc` write without materialising and keep the frame's order
  (`maintain_order=True` is their default). `sink_*(..., lazy=True)` plus
  `pl.collect_all([...])` runs several sinks in one pass.
- `explain()` prints the optimized plan. Look for `SELECTION:` (predicate pushed into the scan),
  `PROJECT n/m COLUMNS` (projection pushdown) and for the `SORT` nodes you expect.
- `collect_schema()` resolves the schema without running the query; `lf.schema`, `lf.columns`
  work but emit a `PerformanceWarning`.
- Read eagerly (`read_csv`, `read_parquet`) only for small files you need whole; `read_csv` is
  `scan_csv(...).collect()` under the hood in 2.x and takes the same arguments.

## Engines

| Setting | Effect |
| --- | --- |
| `lf.collect()` / `engine="auto"` | streaming engine (2.x) |
| `lf.collect(engine="in-memory")` | the pre-2.0 engine for this query |
| `pl.Config.set_engine_affinity("in-memory")`, `POLARS_ENGINE_AFFINITY=in-memory` | process-wide default |
| eager `DataFrame` methods | in-memory, as before |
| `pl.sql(..., eager=True)`, `SQLContext.execute(eager=True)` | go through `collect()`, so streaming |

Switching the engine is not a fix for an ordering bug: the optimizer removes unobserved sorts in
both engines (see below). SQL queries are resolved at `collect()` time in 2.x, so a typo in a
table or column name surfaces there, not when `pl.sql(...)` is called.

## Order rules

1. Operations that are defined row-by-row keep order: `filter`, `with_columns`, `select`, `slice`,
   `head`, `tail`, `sort`.
2. Joins keep no order unless asked: `maintain_order="left"` keeps the left frame's row order,
   and `"right"`, `"left_right"`, `"right_left"` are the other choices. The default is `"none"`.
3. `group_by(...).agg(...)` returns groups in arbitrary order (it changed between three calls in
   one process); `maintain_order=True` keeps first-appearance order and costs some speed.
4. Within a group, values reach the aggregation in the order of the frame that feeds the
   `group_by`. If that frame came from a join, that order is arbitrary.
5. The optimizer drops a `sort` that no later operation observes. A sort followed by a join is not
   observed (the join doesn't keep it), so it disappears from the plan: on both 1.44.2 and 2.1.0,
   `lf.sort("ts").join(other, on="k").group_by("k").agg(pl.col("x").last())` returned the wrong
   `last` for most groups, on any engine.
6. A sort directly before an order-observing operation (`group_by` with `first`/`last`,
   `cum_sum`, `shift`, `head`) is kept.

## Writing order-dependent logic so it can't break

```python
LOAN_ORDER = ["returned_at", "loan_id"]   # always add a unique tiebreaker

per_member = loans.join(members, on="member_id").group_by("member_id").agg(
    pl.col("branch").sort_by(LOAN_ORDER).last().alias("last_branch"),
    pl.col("branch").sort_by(LOAN_ORDER).first().alias("first_branch"),
    pl.col("isbn").sort_by(LOAN_ORDER).tail(3).alias("recent_isbns"),
    pl.col("fine_cents").sort_by(LOAN_ORDER).get(-2, null_on_oob=True).alias("previous_fine"),
)

running = loans.join(members, on="member_id").with_columns(
    fines_to_date=pl.col("fine_cents").cum_sum().over("member_id", order_by=LOAN_ORDER),
    since_previous=pl.col("returned_at").diff().over("member_id", order_by=LOAN_ORDER),
)
```

- `max_by(col)` / `min_by(col)` pick the value at the max/min of another column; with ties they
  don't specify which row wins, so use `sort_by([...]).last()` when ties matter.
- `over(..., order_by=...)` orders inside each window without reordering the frame; the result
  lines up with the original rows.
- `sort_by` in `agg` takes several keys and `descending=[...]`.
- For "first row per key in file order" use `with_row_index()` right after the scan and sort by it.

## Testing order sensitivity

- Compare engines: `lf.collect(engine="streaming").equals(lf.collect(engine="in-memory"))`. With
  a final `sort`, they must be equal; if not, an aggregation depends on an order you didn't set.
- Use fixtures where input rows are shuffled, timestamps collide, and keys come from a join.
  Three-row fixtures already show join reordering on 2.x.
- Compare against a plain-Python reference on a few thousand rows rather than snapshotting Polars'
  own output.

## Pushdown and performance notes

- Filters on scanned columns are pushed into Parquet (row-group statistics) and CSV readers.
  Filters that need a computed column are applied after it is computed.
- Prefer native expressions to `map_elements`: a Python UDF runs one value at a time under the GIL.
- `pl.Config.set_streaming_chunk_size()` tunes morsel size; the old `POLARS_STREAMING_CHUNK_SIZE`
  environment variable is ignored.
