# Porting Polars 0.19, 0.20 and 1.x code to Polars 2

Checked on polars 2.1.0 (Python 3.14). "Old" results were produced by running the same snippet on
polars 0.19.19, 0.20.31 and 1.44.2.

## How to port without changing outputs

1. Pin the target version in the lockfile (`polars` and `polars-runtime-32`) and run the tests.
2. Fix everything that raises. Removed APIs raise `AttributeRemovedError` / `ArgumentRemovedError`
   with a pointer; most pointers are a safe rename.
3. Then go through the **silent** table below. These calls either still run or have an obvious
   replacement that runs, and return different values, columns or row counts.
4. For each function, feed the edge cases the tests don't cover (unknown codes, non-ASCII text,
   keys present on one side only, empty lists, NaN, equal timestamps) through the old and the new
   version and compare. Keep a throwaway virtualenv with the old polars for this; abi3 wheels for
   0.19.19 and 0.20.31 still install on Python 3.14.
5. Don't silence errors by pinning back, by `strict=False` everywhere, or by catching exceptions.

Grep for the risky call sites:

```sh
rg -n 'how="outer"|map_dict|\.str\.lengths|\.str\.n_chars|\.count\(\)|value_counts|\.explode\(|str\.concat|with_row_count|how="horizontal"|pl\.datetime\(|\.replace\(|cs\.[a-z_]+\(\) *[&|^] *pl\.col' src
```

## Silent changes (no error, different result)

| Old call | Old result | On 2.1, unchanged or with the obvious port | Keep the old result with |
| --- | --- | --- | --- |
| `a.join(b, on="k", how="outer")` (0.19) | one `k` column, filled from both sides | `how="full"`: `k` and `k_right`; `k` is null for right-only rows (0.20+ behaviour) | `how="full", coalesce=True` |
| `s.map_dict(m)` | unmapped → null, dtype from the mapping | `s.replace(m)`: unmapped kept; dtype of `s` kept (`"1"` not `1`) | `s.replace_strict(m, default=None)`, `return_dtype=` if needed |
| `s.str.lengths()` | UTF-8 **byte** length (`"héllo"` → 6) | the hint suggests `len_chars()` → 5 | `s.str.len_bytes()` |
| `s.str.n_chars()` | character length | removed | `s.str.len_chars()` |
| `df.groupby(k).count()` | columns `k`, `count` | `group_by(k).len()` → `k`, `len` | `group_by(k).len(name="count")` |
| `pl.count()` in `agg`/`select` | column `count` | `pl.count()` without arguments raises; `pl.len()` → column `len` | `pl.len().alias("count")` |
| `s.value_counts()` | 0.19: `s`, `counts`; 0.20-1.x: `s`, `count` | `s`, `count` | `value_counts(name="counts")` for 0.19 consumers |
| `df.explode("l")` with `[]` rows | one null row per empty list | zero rows per empty list | `explode("l", empty_as_null=True)` |
| `s.str.concat()` | joined with `"-"` | removed; `str.join()` joins with `""` | `str.join("-")` |
| `df.with_row_count()` | column `row_nr` (UInt32) | removed; `with_row_index()` → column `index` | `with_row_index("row_nr")` |
| `pl.concat([a, b], how="horizontal")` | shorter frame padded with nulls | raises `ShapeError` | `how="horizontal_extend"` |
| `df.with_columns(pl.datetime("year", "month", "day"))` | new column `datetime` | column named `year`: **overwrites `year`** | `.alias("datetime")` |
| `pl.repeat(...)` | named `repeat` | named after the first argument (`literal` for a literal) | `.alias(...)` |
| `cs.integer() & pl.col("x")` | selects `x` | element-wise bitwise `&` of every integer column with `x` | `cs.integer() & cs.by_name("x")` |
| `Int64 + UInt64` | `Float64` (lossy) | `Int128` (exact) | cast explicitly if a consumer can't read Int128 |
| `read_csv(schema={...})` | matched by position | matched by name (correct, but different) | nothing: check your schema names |
| `read_csv(columns=[2, 1])` | columns sorted | in requested order | ask for the order you want |
| `read_csv(..., has_header=False)` | `column_1`, `column_2`, ... | `column_0`, `column_1`, ... | `new_columns=[...]` |
| `list.to_struct()` on a null list | struct of nulls | null struct | `fill_null` the struct if needed |
| reading `BytesIO` right after writing | rewound automatically | reads from the current position | `buf.seek(0)` |
| lazy `join` / `unpivot` / `group_by` order | often looked like input order (in-memory engine) | arbitrary (streaming engine) | `maintain_order=...`, `over(order_by=)`, `sort_by` in `agg`, final `sort` |
| `scan_csv` over many files | schema from all files | schema from the first 10 (`infer_schema_files=10`) | `infer_schema_files=` or an explicit `schema` |
| `cut()` / `qcut()` | right-closed bins | deprecated; `bin_intervals`/`bin_quantiles` are left-closed by default | `right_closed=True`, and pass `labels` |

## Now an error (you will see these)

| Old | New |
| --- | --- |
| `df.groupby(...)` | `df.group_by(...)` (renamed in 0.19, removed in 1.0) |
| `Expr.apply(f)` | `map_elements(f, return_dtype=...)`; prefer a native expression |
| `Expr.map(f)` | `map_batches(f, return_dtype=...)` |
| `cumsum`, `cumprod`, `cummin`, `cummax`, `cumcount` | `cum_sum`, `cum_prod`, `cum_min`, `cum_max`, `cum_count` |
| `str.strip`, `str.lstrip`, `str.rstrip` | `str.strip_chars`, `str.strip_chars_start`, `str.strip_chars_end` |
| `str.concat(delim)` | `str.join(delim)` (default delimiter `""`) |
| `melt(id_vars=, value_vars=)` | `unpivot(index=, on=)` |
| `pivot(values=, index=, columns=)` | `pivot(on=, index=, values=)` |
| `with_row_count(name, offset)` | `with_row_index(name, offset)` |
| `replace(m, default=x)` / `replace(m, return_dtype=)` | `replace_strict(m, default=x, return_dtype=)` |
| `join(how="outer")`, `how="outer_coalesce"` | `how="full"` / `how="full", coalesce=True` |
| `join(join_nulls=True)` | `join(nulls_equal=True)` |
| `top_k(k, by=, descending=)` | `top_k(k, by=, reverse=)` |
| `rolling_*(min_periods=)`, `pl.rolling_cov(min_periods=)` | `min_samples=` |
| `rolling(by=)`, `group_by_dynamic(by=)`, `upsample(by=)` | `group_by=` |
| `read_csv(dtypes=)` | `schema_overrides=` |
| `read_csv(row_count_name=)` | `row_index_name=` |
| `read_csv_batched()` | `scan_csv(...).collect_batches()` |
| `read_csv(n_threads=, batch_size=, sample_size=, rechunk=)` | removed; `.rechunk()` the result |
| `read_parquet(allow_missing_columns=True)` | `missing_columns="insert"` |
| `LazyFrame.fetch(n)` | `head(n).collect()` |
| `LazyFrame.profile()` | removed |
| `collect(streaming=True)` | `collect(engine="streaming")` |
| `collect(predicate_pushdown=False, ...)` | `collect(optimizations=pl.QueryOptFlags(predicate_pushdown=False))` |
| `LazyFrame.with_context(...)` | `pl.concat([...], how="horizontal")` |
| `Expr.where(cond)` | `filter(cond)` |
| `Expr.flatten()` | `list.explode(...)` (check null semantics) |
| `Expr.str.explode()` | `str.split("").explode()` (empty strings become null) |
| `dt.datetime()` | `dt.replace_time_zone(None)` |
| `dt.with_time_unit()` | cast to Int64, then to the target dtype |
| `dt.mean()`, `dt.median()` on a Series | `mean()`, `median()` |
| `Series.cat.get_categories()` | `unique()`, or `dtype.categories` for an Enum |
| `Series.equals(strict=)`, `assert_frame_equal(check_dtype=)` | `check_dtypes=` |
| `to_numpy(zero_copy_only=)` | `allow_copy=` (inverted) |
| `scan/read_csv(missing_utf8_is_empty_string=)` | `empty_string_is_null=` (inverted) |
| `shift(None)` | raises; pass an integer |
| `list.to_struct(upper_bound=...)` / no `fields` | `list.to_struct(["f0", "f1", ...])` |
| `list.gather(0)` (flat index) | `list.gather([0])`; per-row index: `list.get(pl.col("i"))` |
| `cast(pl.Date)` on strings | `str.to_date(fmt)` (and `to_datetime`, `to_time`) |
| integer ↔ Enum/Categorical cast | `cat.to(enum)`, `cat.physical()` |
| scalar → List cast | `pl.list(expr)` |
| `bool_col & int_col` | cast the Boolean first |
| `std()`/`var()` on Duration | `dt.total_microseconds().std()` |
| `"a" + 1`, `int_col + "1"` (2.1) | cast explicitly |
| `is_in` with lossy coercion (`int_col.is_in([1.5])`) | cast one side; even `[1.0]` against Int64 raises |
| `Decimal` needle `is_in` float data | compare as the same type |
| naive `Datetime` `is_in` aware values | `dt.replace_time_zone` on one side |
| `DataFrame.__dataframe__()`, `polars.interchange` protocol | `to_arrow()` / `to_pandas()` |
| `pl.threadpool_size()` | `pl.thread_pool_size()` |
| `Config.set_auto_structify()` | wrap with `pl.struct(...)` |

## 1.x changes that 0.19/0.20 code also hits

- `Series(values, dtype=..., strict=True)` really is strict now; mixed values raise.
- `get`/`gather` raise on out-of-bounds indices; `get(i, null_on_oob=True)` returns null.
- `clip` no longer propagates nulls from the bounds.
- `str.to_datetime` with `%f`/`%.f` defaults to microsecond precision.
- `pivot` with several `values` columns names outputs `{value}_{on}`.
- `read/scan_parquet` disables Hive partitioning for single-file inputs.
- `group_by_dynamic` default `offset` is zero.
- `Series.equals` no longer compares names unless `check_names=True`.
- `LazyFrame.schema` / `.columns` / `.dtypes` / `.width` emit a `PerformanceWarning`; use
  `collect_schema()`.
