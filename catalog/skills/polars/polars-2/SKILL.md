---
name: polars-2
description: Write, review and port Polars code for Polars 2 (polars 2.x on Python, checked against 2.1.0). Covers the lazy API and the streaming engine that is now the default for LazyFrame.collect, row order (joins, group_by, sorts the optimizer drops before a join, order-dependent aggregations such as last, shift and cum_sum after a join), null versus NaN in aggregations and CSV input, joins (full joins that do not coalesce keys, nulls_equal, maintain_order, validate), replace versus replace_strict, explode of empty lists, string-to-date parsing, strict casts and is_in, and porting 0.19, 0.20 and 1.x code without silent output changes (how="outer", map_dict, str.lengths, groupby().count(), value_counts, with_row_count, melt, pivot, apply, cumsum). Use when code imports polars, uses scan_csv/scan_parquet/LazyFrame/collect/sink_parquet, when upgrading polars, when a polars error says something was removed or renamed in 2.0, or when results look wrong after a join, group_by or read_csv.
license: MIT
---

# Polars 2

Polars 2.0 shipped on 2026-10-06 and 2.1.0 on 2026-10-25. Most Polars code in tutorials and model
training data is 0.19, 0.20 or 1.x. Much of it now raises (good: you find it), and some of it still
runs and returns different numbers, columns or row counts (bad). Everything below was run on
polars 2.1.0 with Python 3.14; the old behaviour quoted for comparison was run on 0.19.19, 0.20.31
and 1.44.2.

## 1. Check what you are writing against

```sh
python -c "import polars as pl; print(pl.__version__)"
```

- `polars` 2.x is a thin package that depends on `polars-runtime-32`; `polars[rt64]` (more than
  2^32 rows) and `polars[rtcompat]` (CPUs without AVX2) pull in the other runtimes. Lock the runtime
  package too, not just `polars`.
- Removed APIs raise `polars.exceptions.AttributeRemovedError` (an `AttributeError`) or
  `ArgumentRemovedError` (a `TypeError`) with a hint. **The hints are not always a safe
  replacement**: section 6 lists the ones that change results if you follow them literally.

## 2. Lazy by default, streaming by default

- Use `pl.scan_csv` / `pl.scan_parquet` / `pl.scan_ndjson` and build a `LazyFrame`; collect once at
  the end, or `sink_parquet` / `sink_csv` / `sink_ndjson` to write without materialising.
- `LazyFrame.collect()` defaults to `engine="auto"`, which in 2.x means the **streaming engine**.
  `engine="in-memory"` or `pl.Config.set_engine_affinity("in-memory")` (or
  `POLARS_ENGINE_AFFINITY=in-memory`) restores the old engine; `collect(streaming=True)` is gone.
  Eager `DataFrame` methods still run in memory. `pl.read_csv` is now `scan_csv(...).collect()`.
- Optimizer switches are one object: `collect(optimizations=pl.QueryOptFlags(predicate_pushdown=False))`.
  The old `predicate_pushdown=` / `no_optimization=` keywords were removed.
- `lf.collect_schema()` and `lf.collect_schema().names()` instead of `lf.schema` / `lf.columns`
  (those still work but warn: resolving a schema can be expensive).
- `LazyFrame.profile()` was removed; `explain()` prints the optimized plan. Use it to see what the
  optimizer kept: a `SORT` you wrote may not be in it (next section).
- `scan_csv(...).collect_batches()` replaces `read_csv_batched()`.

## 3. Row order: say it where it matters

Polars only guarantees row order where an operation is defined to keep it. In 2.x the streaming
engine makes the rest visibly unordered, even on three-row frames.

| Operation | Order of the output |
| --- | --- |
| `filter`, `with_columns`, `select`, `head` on a frame you ordered | kept |
| `join`, any `how` | **not guaranteed** (lazy joins visibly reorder in 2.x) unless `maintain_order="left"` / `"right"` / `"left_right"` / `"right_left"` |
| `group_by(...).agg(...)` | groups in arbitrary order (changes between runs) unless `maintain_order=True` |
| `unique()` | arbitrary unless `maintain_order=True`; default `keep="any"` picks any duplicate |
| `unpivot` in lazy pipelines | not guaranteed by the streaming engine; sort if you rely on it |
| full join | unmatched rows are appended in an unspecified place; sort the result |

**The trap that survives code review:** a `sort()` placed before a join does not order anything
after the join. The optimizer drops a sort whose order nobody observes (it is absent from
`explain()`), and the join would not keep it anyway. So this is wrong on 1.44 and on 2.1:

```python
latest = (
    trips.sort("ended_at")                       # dropped: the join does not observe it
    .join(riders, on="rider_id", how="inner")
    .group_by("rider_id")
    .agg(pl.col("station").last())               # "last" of an arbitrary order
)
```

Put the order inside the order-dependent expression instead:

```python
TRIP_ORDER = ["ended_at", "trip_id"]             # a tiebreaker for equal timestamps
by_trip_time = pl.col("station").sort_by(TRIP_ORDER)

latest = (
    trips.join(riders, on="rider_id", how="inner")
    .group_by("rider_id")
    .agg(
        by_trip_time.last().alias("last_station"),
        by_trip_time.get(-2, null_on_oob=True).alias("station_before"),   # null for one-trip riders
        pl.col("fare_cents").max_by("ended_at").alias("fare_of_latest"),  # one key; ties not ordered
    )
    .sort("rider_id")                            # the result order you promise callers
)

fares = trips.join(riders, on="rider_id").with_columns(
    fare_to_date=pl.col("fare_cents").cum_sum().over("rider_id", order_by=TRIP_ORDER),
    previous_station=pl.col("station").shift(1).over("rider_id", order_by=TRIP_ORDER),
)
```

- `Expr.over(..., order_by=...)` orders `cum_sum`, `shift`, `diff`, `rank`-style window functions
  inside each partition regardless of the frame's row order.
- `sort_by(...)` inside `agg` orders a group's values for `first`/`last`/`get`/`head`/`tail`/`shift`.
- `get(i)` and `gather` raise on out-of-bounds indices (since 1.0); pass `null_on_oob=True` when a
  group can be shorter.
- A `sort()` placed **right before** an order-dependent step (a `group_by` with `last()`, a
  `with_columns(cum_sum())`) is observed and kept, but it couples correctness to plan shape; prefer
  the explicit forms above.
- If a caller relies on output order, end with `.sort(...)`. Don't promise "input order".
- When order matters, test that `lf.collect(engine="streaming").equals(lf.collect(engine="in-memory"))`;
  an order bug usually makes them differ.

## 4. Null is missing, NaN is a number

Polars has one missing value, `null`. `NaN` is an ordinary float.

| On `[1.0, NaN, null, 3.0]` | Result |
| --- | --- |
| `mean()`, `sum()`, `std()` | `NaN` (NaN propagates) |
| `min()`, `max()` | `1.0`, `3.0` (NaN skipped unless all values are NaN; `nan_min`/`nan_max` propagate) |
| `count()` / `len()` | `2` (non-null, NaN included) / `4` |
| `is_null()` | only the null; `is_nan()` is null for the null |
| `fill_null(0)` | NaN stays NaN |
| `== float("nan")` | `True` for NaN (Polars treats NaN as equal to NaN), and `n_unique()` counts it |

- CSV: an empty field is read as null, the text `NaN` as float NaN. When NaN means "no
  measurement", convert at the boundary: `pl.col(cols).fill_nan(None)` after reading, or
  `read_csv(..., null_values=["NaN"])` / `scan_csv(..., null_values=[...])`.
- Never drop rows to get rid of NaN in one column; other columns in the row may be fine, and a
  group whose values are all missing should still produce a row (with null stats).
- `pl.len()` counts rows, `pl.col(c).count()` counts non-null values.

## 5. Joins, replace, explode

**Joins.**
- `how` is `inner`, `left`, `right`, `full`, `semi`, `anti`, `cross`; `how="outer"` raises.
- `coalesce` default: one key column for inner/left/right; **two** for `full` (`key`, `key_right`,
  null on the side that didn't match). Want one key column? `how="full", coalesce=True`.
- Null keys never match unless `nulls_equal=True` (was `join_nulls`).
- `validate="m:1"` / `"1:1"` turns a duplicate-key surprise into an error.
- `join_asof` and `join_where` cover nearest and inequality joins.

**replace vs replace_strict.**
- `replace(mapping)` keeps unmapped values and keeps the input dtype: on a String column,
  `replace({"a": 1})` returns the string `"1"`.
- `replace_strict(mapping)` raises on an unmapped value; `replace_strict(mapping, default=None)`
  maps unknown values to null (what 0.19's `map_dict` did); `return_dtype=` sets the output dtype.
- `replace(..., default=...)` / `replace(..., return_dtype=...)` were removed: use `replace_strict`.

**explode.**
- An empty list now explodes to **zero rows** (2.0). A null list still gives one null row
  (`keep_nulls=True`). `explode(col, empty_as_null=True)` restores one null row per empty list.
- Row counts and "every key appears" guarantees change silently; check any report that explodes a
  list that can be empty (for example after `list.eval(pl.element().filter(...))`).

## 6. Porting old code: the hints that change results

| Old code | Error hint / obvious port | What keeps the old output |
| --- | --- | --- |
| `join(how="outer")` (0.19: one key column) | `how="full"` | `how="full", coalesce=True` |
| `map_dict(m)` (unknown → null) | `replace(m)` (unknown kept, dtype kept) | `replace_strict(m, default=None)` |
| `map_dict(m, default=x)` | `replace(m, default=x)` raises | `replace_strict(m, default=x)` |
| `str.lengths()` (**bytes**) | "Did you mean `len_chars`?" | `str.len_bytes()`; `n_chars()` → `len_chars()` |
| `groupby(k).count()` (column `count`) | `group_by(k).len()` (column `len`) | `group_by(k).len(name="count")` |
| `pl.count()` in `agg` (column `count`) | `pl.len()` (column `len`) | `pl.len().alias("count")` |
| `s.value_counts()` (column `counts` in 0.19, `count` since 0.20) | unchanged call | `s.value_counts(name="counts")` if consumers read `counts` |
| `explode(list_col)` with empty lists | unchanged call | `explode(list_col, empty_as_null=True)` |
| `str.concat()` (delimiter `"-"`) | `str.join()` (delimiter `""`) | `str.join("-")` |
| `with_row_count()` (column `row_nr`) | `with_row_index()` (column `index`) | `with_row_index("row_nr")` |
| `pl.concat(..., how="horizontal")` with unequal heights (padded) | now raises | `how="horizontal_extend"` |
| `with_columns(pl.datetime("y", "m", "d"))` (column `datetime`) | unchanged call | output is named after `y` and **overwrites it**: add `.alias(...)` |
| `cs.numeric() & pl.col("x")` (column selection) | unchanged call | now an element-wise `&`: use `cs.by_name("x")` |
| Int64 + UInt64 (Float64) | unchanged | now `Int128`; `to_pandas()`/`to_arrow()`/`to_numpy()` then raise: cast first |

Mechanical renames (these raise, so you'll find them): `groupby`→`group_by`, `apply`→`map_elements`
(pass `return_dtype`; prefer native expressions), `map`→`map_batches`, `cumsum`/`cumprod`/`cummax`→
`cum_*`, `str.strip`→`str.strip_chars`, `melt(id_vars, value_vars)`→`unpivot(index=, on=)`,
`pivot(columns=)`→`pivot(on=)`, `read_csv(dtypes=)`→`schema_overrides=`, `top_k(descending=)`→
`reverse=`, `rolling_*(min_periods=)`→`min_samples=`, `join(join_nulls=)`→`nulls_equal=`,
`collect(streaming=True)`→`engine="streaming"`, `Expr.where`→`filter`, `str.concat`→`str.join`.
The full table, including CSV and dtype changes, is in
[references/migration.md](references/migration.md).

## 7. Parsing, casting, dtypes

- String to temporal: `str.to_date(fmt)`, `str.to_datetime(fmt, time_zone=...)`, `str.to_time`,
  or `str.strptime(dtype, fmt)`. `cast(pl.Date)` on strings was removed in 2.0. Give the format:
  inference picks one format per column and fails on mixed data.
- Without a format, an ISO string with `Z` or an offset parses to a UTC-aware `Datetime`. With a
  format, a literal `Z` (`"%Y-%m-%dT%H:%M:%SZ"`) gives a **naive** datetime: add
  `time_zone="UTC"`. `dt.date()` gives the date in the column's zone; `dt.convert_time_zone(...)`
  first for a local calendar day.
- `cast` is strict: one bad value raises. `cast(..., strict=False)` or `str.to_integer(strict=False)`
  turns failures into nulls. Count those nulls; don't let them vanish.
- `is_in` only coerces losslessly now: an Int64 column `is_in([1.5])` (or even `[1.0]`) raises;
  cast one side. Datetime units are converted; naive versus aware raises.
- Removed casts: string → temporal, integer ↔ Categorical/Enum (`cat.to(...)`, `cat.physical()`),
  scalar → List (`pl.list(...)`), Boolean `&` Int, struct casts that drop fields (unless
  `strict=False`). Mixed string/number arithmetic raises (2.1).
- `read_csv(schema=...)` is matched by column **name** now (it was positional); `columns=[...]`
  keeps the requested order; headerless files are `column_0`, `column_1`, ...; multi-file
  `scan_csv` infers from the first 10 files.
- Reading from a `BytesIO` no longer rewinds it: `buf.seek(0)` after writing.

More on dtypes, NaN and decimals in [references/dtypes-and-missing-data.md](references/dtypes-and-missing-data.md).

## 8. Idioms

- Expressions over Python: `map_elements` runs Python per value; when it recognises the lambda it
  warns (`PolarsInefficientMapWarning`) and prints the native expression to use instead.
  `map_batches` for whole-Series functions. Always pass `return_dtype` to either.
- `with_columns(name=expr)` keyword form for new columns; `pl.col(a, b)` or selectors
  (`import polars.selectors as cs`) for several.
- `pl.when(...).then(...).otherwise(...)`: without `otherwise` the rest is null.
- `group_by(...).agg(...)` with explicit aliases; `group_by(...).len(name=...)` for counts.
- `.over(partition_by, order_by=...)` for window functions; `group_by_dynamic` / `rolling` for time
  windows (`group_by=` instead of `by=`).
- `cut`/`qcut` are deprecated for `bin_intervals`/`bin_quantiles`/`bin_ranks` (left-closed by
  default; pass `right_closed=True` to match `cut`).

## 9. Review checklist

- [ ] Every `last`/`first`/`shift`/`cum_*`/`diff`/`head` after a join or group_by has its own
      `sort_by`, `over(order_by=...)` or an explicit sort right before it, with a tiebreaker.
- [ ] Output order callers rely on is set by a final `.sort(...)`.
- [ ] NaN in float inputs is either meaningful or converted to null at the boundary.
- [ ] Full joins say `coalesce=True` when one key column is expected; null keys are intended.
- [ ] `replace` is only used where unmapped values should pass through unchanged.
- [ ] `explode` on lists that can be empty states `empty_as_null`.
- [ ] Column names produced by `len()`, `value_counts()`, `with_row_index()`, `pl.datetime()` are
      aliased when consumers read them.
- [ ] Lazy pipelines stay lazy until the end; `explain()` shows the sorts and filters you expect.

## References

- [Migration from 0.19, 0.20 and 1.x: every removal, rename and silent change](references/migration.md)
- [Lazy API, streaming engine, pushdown, sinks and ordering](references/lazy-and-ordering.md)
- [Dtypes, nulls, NaN, casting and parsing](references/dtypes-and-missing-data.md)
- [Sources and what was reproduced](references/sources.md)
