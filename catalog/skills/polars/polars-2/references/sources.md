# Sources

Checked on 2026-11-01 against `polars==2.1.0` (PyPI, published 2026-10-25, with
`polars-runtime-32==2.1.0`) on CPython 3.14. Every behaviour in this skill was run on the installed
package; old behaviour was run on polars 0.19.19, 0.20.31 and 1.44.2 installed side by side in
separate virtualenvs on Python 3.14.

## Official documentation and release notes

- Upgrade guide for 2.0 (breaking changes, removed casts, API reshapes, CSV changes, removal
  table): https://docs.pola.rs/releases/upgrade/2/ (source:
  `docs/source/releases/upgrade/2.md` in pola-rs/polars)
- Upgrade guide for 1.0: https://docs.pola.rs/releases/upgrade/1/ (source:
  `docs/source/releases/upgrade/1.md`)
- Release notes for py-2.0.0 (2026-10-06) and py-2.1.0 (2026-10-25, "Disallow mixed string <=>
  numeric arithmetic in eager"): https://github.com/pola-rs/polars/releases
- Installation and runtime extras (`rt64` for more than 2^32 rows, `rtcompat` for CPUs without
  AVX2): https://docs.pola.rs/user-guide/installation/
- Python API reference (signatures quoted here were read with `inspect.signature` on 2.1.0):
  https://docs.pola.rs/api/python/stable/reference/
- Lazy API, streaming and query optimization: https://docs.pola.rs/user-guide/lazy/
- Missing data (null versus NaN): https://docs.pola.rs/user-guide/expressions/missing-data/
- Joins (`coalesce`, `maintain_order`, `nulls_equal`, `validate`):
  https://docs.pola.rs/user-guide/transformations/joins/
- Window functions and `over(order_by=...)`: https://docs.pola.rs/user-guide/expressions/window-functions/

## Reproduced by running it

On 2.1.0, unless noted:

- `lf.sort("ts").join(other, on="k").group_by("k").agg(pl.col("x").last())` returned the wrong
  `last` for most groups with the default engine, with `engine="in-memory"`, with
  `POLARS_MAX_THREADS=1`, inside `python:3.14-slim`, and on 1.44.2. `explain()` shows no `SORT`
  node. `sort_by(...)` inside `agg`, `over(..., order_by=...)` and `maintain_order="left"` gave the
  correct result in every configuration.
- A lazy left join of a 3-row frame returned keys `[0, 2, 1]` for a left side of `[0, 1, 2]`;
  `maintain_order="left"` restored `[0, 1, 2]`. Three `group_by().agg()` calls in one process
  returned the groups in three different orders.
- On `[1.0, NaN, None, 3.0]`: `mean`/`sum` NaN, `min`/`max` 1.0/3.0, `count` 2, `fill_null(0)` keeps
  NaN, `NaN == NaN` is true, `n_unique([NaN, NaN, None])` is 2. CSV `NaN` text reads as float NaN,
  empty unquoted fields as null, quoted `""` as an empty string.
- `join(how="full")` keeps `k` and `k_right`; `coalesce=True` gives one column. `how="outer"`
  raises `ValueError` pointing to `how="full"`. On 0.19.19, `how="outer"` produced a single
  coalesced key column; on 0.20.31 it already produced two.
- 0.19.19: `map_dict` mapped unknown values to null; `str.lengths()` returned 6 for `"héllo"` and
  `n_chars()` 5; `groupby().count()` named its column `count`; `value_counts()` returned
  `counts` (`count` on 0.20.31 and 1.44.2); `explode` of `[]` gave a null row (also on 0.20.31 and
  1.44.2); `str.concat()` joined with `-`; headerless CSV columns started at `column_1`;
  `Int64 + UInt64` was Float64; `pl.datetime(...)` was named `datetime`.
- 2.1.0: `replace({"a": 1})` on a String column returns `"1"`; `replace_strict(m, default=None)`
  returns null for unknown values; `explode` drops empty lists unless `empty_as_null=True`;
  `with_columns(pl.datetime("year", "month", "day"))` overwrote `year`; `Int64 + UInt64` is
  Int128, which survives `write_parquet` but makes `to_arrow()`, `to_pandas()` (pyarrow 26.0.0)
  and `to_numpy()` raise; `cs.integer() & pl.col("mask")` is element-wise.
- 2.1.0: `str.to_datetime("%Y-%m-%dT%H:%M:%SZ")` is naive, `str.to_datetime()` on the same string
  is UTC-aware; a DST-gap wall time raises with `time_zone=` and becomes null with
  `dt.replace_time_zone(tz, non_existent="null")`; `is_in` of an Int64 column against `[1.0]`
  raises; `"a" + 1` raises; `pl.Series(["2022-08-30"]).cast(pl.Date)` raises.
- `io.BytesIO` round trip: `read_parquet` right after `write_parquet` raises until `seek(0)`.
- Removed APIs raised `AttributeRemovedError`/`ArgumentRemovedError` with the messages quoted in
  the migration reference: `with_row_count`, `melt`, `pivot(columns=)`, `replace(default=)`,
  `top_k(descending=)`, `join(join_nulls=)`, `rolling_mean(min_periods=)`, `read_csv(dtypes=)`,
  `collect(streaming=True)`, `str.concat`, `GroupBy.count`, `Expr.flatten`. `groupby`, `apply`,
  `map_dict`, `cumsum`, `str.lengths` raise plain `AttributeError`.
