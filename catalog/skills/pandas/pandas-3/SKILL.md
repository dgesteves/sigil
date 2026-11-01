---
name: pandas-3
description: Write, review and upgrade pandas 3.x code (checked against 3.1.0, NumPy 2.5). Covers the changes that silently give wrong numbers or no-ops with pandas 2 habits - Copy-on-Write (chained assignment and column-level inplace calls that do nothing, read-only NumPy views, when a copy is still needed), the default str dtype (dtype == object checks, select_dtypes, NaN as missing, astype(str)), datetime64[us] inference (astype("int64") epoch and duration math 1000x off, merge_asof unit mismatches), groupby observed=True, pct_change without forward fill, stack keeping NaN, builtins in agg, zoneinfo, calendar-day offsets, and removed APIs and aliases (M, Q, Y, H, T, applymap, first, fillna(method), Series.view). Use when code imports pandas, when upgrading from pandas 2.x, when a pandas bump breaks tests or changes outputs, or on ChainedAssignmentError, Pandas4Warning, "Invalid frequency" or epoch timestamps in 1970.
license: MIT
---

# pandas 3

pandas 3.0 (January 2026) is the first major release since 2.0 (April 2023), and 3.1.0 (October
2026) is current. Most pandas code on the web and in training data is pandas 1.x/2.x. The upgrade breaks
loudly in a few places (removed methods, removed frequency aliases) and **silently** in more:
code keeps running and returns different numbers, or quietly stops updating a DataFrame.
Everything below was run on pandas 3.1.0, NumPy 2.5.4, Python 3.14, with and without pyarrow.

## 1. Check what you are running

```sh
python -c "import pandas as pd, numpy as np; print(pd.__version__, np.__version__)"
python -c "import pandas as pd; print(pd.Series(['x']).dtype.storage)"   # 'pyarrow' or 'python'
```

pandas 3.1 needs NumPy >= 2.0.2 and Python >= 3.11. pyarrow is optional: without it the default
string dtype is backed by Python objects, with it by Arrow. The semantics below hold for both.

## 2. The silent changes, in order of how often they bite

| pandas 2 habit | pandas 3 result | Do instead |
| --- | --- | --- |
| `df["col"][mask] = v`, `df[mask]["col"] = v`, `df.loc[i]["col"] = v` | **no-op** + `ChainedAssignmentError` warning | `df.loc[mask, "col"] = v` |
| `df["col"].fillna(0, inplace=True)` (also `replace`, `ffill`, `clip`, `where`...) | **no-op** + `ChainedAssignmentError` warning | `df["col"] = df["col"].fillna(0)` |
| `ts.astype("int64") // 10**9` (or `// 10**6`, `.values.astype(np.int64)`) for epoch values | **1000x too small**: data is usually `datetime64[us]` now | `(ts - EPOCH) // pd.Timedelta(seconds=1)` (section 5) |
| `(end - start).astype("int64") / 1e9` for durations | **1000x too small** | `(end - start) // pd.Timedelta(seconds=1)` or `.dt.total_seconds()` |
| `ser.view("int64")` (removed) "fixed" with `.astype("int64")`, as the 2.2/2.3 deprecation warning suggested | integers in the column's unit, usually microseconds | same as above |
| `if df[c].dtype == object:` to find text columns | **False** for text: it is `str` dtype now | `pd.api.types.is_string_dtype(df[c])` or `select_dtypes(include=["str", "object"])` |
| `df.groupby(categorical)` expecting every category | **unobserved categories dropped** (`observed=True` default) | `groupby(..., observed=False)` (also `pivot_table`) |
| `ser.pct_change()` across gaps | **no forward fill** any more: NaN next to every gap | `ser.ffill().pct_change()` if you relied on the old default |
| `df.stack()` dropping NaN | **NaN rows kept**; `stack(dropna=...)` raises | `df.stack().dropna()` |
| `.agg(sum)`, `.agg(max)` with Python builtins | builtin is called as-is: **NaN** if a group has NaN | `.agg("sum")` |
| `ser.astype(str)` turning NaN into `"nan"` | NaN **stays missing** | `fillna("")` first if you want text |
| `pd.Series(["a", None])` holding `None` | holds `NaN` (str dtype); `.to_dict()` and `json.dumps` get `NaN` (`to_json` writes `null`) | `astype(object).where(s.notna(), None)` before serialising |
| NumPy array from `.to_numpy()` / `.values` / `np.asarray` mutated in place | `ValueError: assignment destination is read-only` | `to_numpy(copy=True)` |
| Assigning a float to an int column, an int to a `str` column | `TypeError: Invalid value ... for dtype` (no silent upcast) | cast the column first: `df["n"] = df["n"].astype("float64")` |

Warnings are your only signal for the first two rows. Run upgrades with them as errors (section 10).

## 3. Copy-on-Write

The rule: **every indexing result and every method result behaves as a copy.** A column you pull
out, a filtered frame, `df.head()`, `df.reset_index()`: changing them never changes `df`, and
changing `df` never changes them. pandas copies lazily, only when one side is written, so this is
cheap.

What follows from it:

- **Modify an object only through itself**: `df.loc[rows, cols] = ...`, `df["col"] = ...`,
  `df.iloc[...] = ...`, or a frame-level method with `inplace=True`.
- Chained assignment never works. pandas 3 emits `pandas.errors.ChainedAssignmentError` (a
  `Warning` subclass, not an exception) and leaves the frame unchanged. Inside functions and
  methods too. The `mode.chained_assignment` option has no effect (deprecated in 3.1).
- `SettingWithCopyWarning` is gone. You no longer need `.copy()` to silence it.
- **You still need a copy at an API boundary.** Copy-on-Write protects the *results* of
  operations, not the object you were handed: `df["station"] = ...` inside a function mutates the
  caller's frame. If a function must not change its input, start with `out = df.copy()` (lazy and
  cheap now) or build the result with `assign`:

  ```python
  def tidy_readings(readings: pd.DataFrame) -> pd.DataFrame:
      return readings.assign(
          station=readings["station"].str.strip(),
          temp_c=readings["temp_c"].fillna(readings["temp_c"].median()),
      )
  ```

- Methods that modify data in place (`fillna`, `replace`, `ffill`, `bfill`, `interpolate`,
  `where`, `mask`, `clip`) keep `inplace=True` on a whole frame or Series you own, and since 3.0
  return the object instead of `None`. **On `df["col"]` they are chained and do nothing.**
- 3.1 deprecates `inplace=` (emits `Pandas4Warning`) on methods that never worked in place:
  `drop`, `rename`, `rename_axis`, `reset_index`, `set_index`, `dropna`, `drop_duplicates`,
  `sort_values`, `sort_index`, `eval`, `query`. Reassign instead: `df = df.dropna()`.
- `copy=` keywords on `astype`, `rename`, `merge`, `reindex` and others are deprecated and
  ignored.
- `for _, row in df.iterrows(): row["x"] = 0` never changes `df`. Vectorise or use `df.loc`.
- Arrays from `.to_numpy()`, `.values` and `np.asarray(...)` are read-only views when no copy was
  needed (single-dtype data). `Index.values` is always read-only since 3.1.

More cases and the upgrade checklist: [references/copy-on-write.md](references/copy-on-write.md).

## 4. The default string dtype

Text is inferred as the `str` dtype (`pd.StringDtype(na_value=np.nan)`), not `object`, in
constructors and every reader (`read_csv`, `read_json`, `read_parquet` ...), and for indexes.

| Check or operation | pandas 3 |
| --- | --- |
| `ser.dtype == object` | `False` for text. `ser.dtype == "str"` is `True` |
| `is_object_dtype(ser)` | `False`; use `is_string_dtype(ser)` (True for `str`) |
| `isinstance(ser.dtype, pd.StringDtype)` | `True` |
| `select_dtypes(include="object")` | still includes `str` columns, with a deprecation warning. Use `include=["str", "object"]` (the second for hand-built object columns) |
| `select_dtypes(include="string")` / `"str"` | selects the default `str` columns |
| missing value | `np.nan` (not `None`, not `pd.NA`); `isna()` works as before |
| setting a non-string | `ser.iloc[0] = 5` raises `TypeError`; cast to `object` first if you really need mixed values |
| `.str.len()` with missing values | `float64` with NaN |
| `.str.contains/startswith/endswith` with missing values | `bool`, missing is `False` (usable as a mask) |
| `== "x"` / `!= "x"` with missing values | `False` / `True` |
| `.astype(str)` | missing stays missing; numbers become text |
| `.apply(str)` / `.map(str)` | still writes `"nan"` for missing values |
| `.str.replace(pat, repl)` | literal match (since 2.0); pass `regex=True` for patterns |
| `dtype="string"` | the opt-in `StringDtype` that uses `pd.NA` (unchanged); differs from `str` in missing-value semantics |
| mixed values (`["a", 1]`) | still `object` |

Stop writing `.astype(object)` "just to be safe" before string work; it is slower and turns off the
string semantics. `pd.options.future.infer_string` is deprecated in 3.1: inference cannot be
switched off in 4.0. Full table and pyarrow notes: [references/string-dtype.md](references/string-dtype.md).

## 5. Datetime and timedelta resolution

pandas 2 stored almost every datetime as `datetime64[ns]`. pandas 3 **infers the unit**:

| Input | Unit in 3.1 |
| --- | --- |
| strings (`to_datetime`, `read_csv(parse_dates=...)`, constructors) | `us`, or `ns` if a value has sub-microsecond digits |
| `datetime.datetime` objects | `us` |
| `np.datetime64` values | their unit, clamped to `s`..`ns` (`datetime64[D]` -> `s`) |
| numbers with `unit=` (`to_datetime(x, unit="s")`, `to_timedelta`) | `us` (3.1 change; 3.0 used the input unit), `ns` if needed |
| `date_range`, `Timestamp.now()`, `Timedelta(seconds=1)` | `us` |
| `Timestamp("...")` | `us`; `Timestamp.value` is **still nanoseconds** |

So **never derive numbers from the raw integer representation.** These are wrong for `[us]` data:
`ts.astype("int64") // 10**9`, `ts.values.astype("int64")`, `td.astype("int64") / 1e9`,
`np.asarray(ts).view("i8")`. `Series.view` itself is removed.

Unit-agnostic recipes (all exact integer arithmetic, no floats):

```python
EPOCH = pd.Timestamp("1970-01-01", tz="UTC")       # use a naive EPOCH for naive columns
SECOND, MILLISECOND = pd.Timedelta(seconds=1), pd.Timedelta(milliseconds=1)

ride_start_ms = (rides["started_at"] - EPOCH) // MILLISECOND        # epoch ms, floored
ride_seconds = (rides["ended_at"] - rides["started_at"]) // SECOND  # whole seconds, floored
started_at = pd.to_datetime(rides["start_epoch_ms"], unit="ms", utc=True)  # back again
```

- With `NaT` the floor division yields `float64` with NaN; finish with `.astype("Int64")` to keep
  integers. Plain `astype("int64")` on a column with `NaT` silently returns
  `-9223372036854775808`.
- If you need a specific unit, say so: `ts.dt.as_unit("ms").astype("int64")` (`as_unit` truncates
  finer digits silently), or `pd.to_datetime(..., unit="s").dt.as_unit("s")`.
- `.dt.total_seconds()` returns float seconds and is fine for display or when you round yourself.
- Mixed units are fine in arithmetic, comparisons and `merge`, but `merge_asof` raises
  `MergeError: incompatible merge keys` for `datetime64[us]` vs `datetime64[ns]`. Align with
  `.dt.as_unit(...)` first. Columns built from NumPy `ns` arrays or ns-precision strings are the
  usual source.
- Strings for any year from 1 to 9999 now parse (as `us`) instead of raising
  `OutOfBoundsDatetime` outside 1677-2262, the `ns` range.
- `DataFrame.to_json()` still writes epoch milliseconds by default but warns that ISO will become
  the default; pass `date_format="iso"` or `"epoch"` explicitly.

Details, `Timestamp` vs array semantics and interop with NumPy, databases and Parquet:
[references/datetime-resolution.md](references/datetime-resolution.md).

## 6. Time zones, offsets and frequency strings

- Time zones are `zoneinfo.ZoneInfo` (or `datetime.timezone.utc`), not pytz. pytz is no longer
  installed with pandas. Ambiguous or non-existent local times raise `ValueError`, not pytz errors.
- Parsing strings with mixed UTC offsets needs `utc=True`; otherwise it raises.
- `pd.offsets.Day` is a **calendar day**: `Timestamp("2026-03-28 08:00", tz="Europe/Lisbon") +
  pd.offsets.Day(1)` is 08:00 the next day across the DST change; `+ pd.Timedelta(days=1)` is
  24 hours (09:00). `Day(1) != Hour(24)`. Daily `resample("D")` in a local zone gives 23- and
  25-hour bins on DST days.
- Removed aliases raise `ValueError: Invalid frequency`:

  | Removed | Use | Meaning |
  | --- | --- | --- |
  | `M`, `BM`, `SM`, `CBM` | `ME`, `BME`, `SME`, `CBME` | month **end** labels (not `MS`, which is month start) |
  | `Q`, `BQ` | `QE`, `BQE` | quarter end |
  | `Y`, `A`, `BY`, `BA` | `YE`, `BYE` | year end (`A-DEC` -> `YE-DEC`) |
  | `AS`, `BAS` | `YS`, `BYS` | year start |
  | `H`, `BH`, `CBH` | `h`, `bh`, `cbh` | hour |
  | `T`, `L`, `U`, `N` | `min`, `ms`, `us`, `ns` | minute ... nanosecond |

  Periods are the exception: `to_period("M")`, `period_range(freq="M")` and `PeriodIndex` still
  use `M`, `Q`, `Y`, and reject `ME`. Lowercase `d`, `w`, `b` warn (use `D`, `W`, `B`).
  `Timedelta("1H")` still parses with a warning, `Timedelta("5T")` raises.

## 7. Grouping, reshaping and ordering

- `groupby` and `pivot_table` default to `observed=True`. For categorical keys with
  `observed=False`, unobserved groups are now passed to `apply`/`agg` for multi-key groupings
  too, and `prod`/`all`/`any` give `1`/`True`/`False` for them.
- `groupby(...).apply(f)` no longer passes the grouping columns to `f` (`include_groups=True`
  raises). Select what you need or use `agg`/`transform`.
- `axis=` is removed from `groupby`, `rolling`, `resample`; `groupby(...).fillna` and
  `Resampler.fillna` are removed (use `ffill()`/`bfill()` on the group).
- `apply`/`agg`/`transform` no longer swap callables for pandas methods. Python builtins (`sum`,
  `max`, `min`) then see NaN and return NaN; NumPy functions (`np.sum`) still dispatch to the
  Series method. Use the string names (`"sum"`, `"max"`) for the NaN-skipping pandas behaviour.
- `DataFrame.value_counts(sort=False)` keeps input order (it used to sort by labels).
- `concat` of objects that all have a `DatetimeIndex` honours `sort=False`; without `sort` it still
  sorts and warns. Pass `sort=` explicitly.
- `idxmin`/`idxmax`/`argmin`/`argmax` raise on all-NA input or `skipna=False` with NA.
- `Series[int]` is always a **label** lookup: `rainfall[-1]` raises `KeyError` on a DatetimeIndex.
  Use `.iloc[-1]`.

## 8. Removed APIs and their faithful replacements

| Removed | Replacement | Watch out |
| --- | --- | --- |
| `df.applymap(f)` | `df.map(f)` | `df.apply(f)` passes whole columns, not cells |
| `fillna(method="ffill")` | `ffill()` / `bfill()` | `fillna(0)` is not the same thing |
| `ser.first("3D")` / `last` | `ser[ser.index < ser.index[0] + pd.Timedelta(days=3)]` | `.loc[:start + 3 days]` also keeps a label exactly 3 days later; `head(3)` counts rows |
| `ser.view("int64")` | unit-aware epoch math (section 5) | `astype("int64")` gives the column's unit |
| `df.append(other)` | `pd.concat([df, other])` | removed since 2.0 |
| `swapaxes`, `Series.ravel`, `DataFrame.bool`, `pd.value_counts` | `transpose`, `to_numpy().ravel()`, `.item()`, `ser.value_counts()` | |
| `int(ser)`, `float(ser)` | `int(ser.iloc[0])` or `ser.item()` | |
| `read_csv(delim_whitespace=True)` | `sep=r"\s+"` | |
| `read_csv(date_parser=...)`, `infer_datetime_format=`, `keep_date_col=`, combined `parse_dates` lists | `date_format=`, or parse after reading | |
| `read_json("[...]")` with a literal string | `read_json(io.StringIO(text))` | a raw string is treated as a path |
| `to_datetime(..., errors="ignore")`, `to_numeric(errors="ignore")` | `errors="coerce"` plus your own fallback | |
| `replace(..., method=)`, `replace(x)` without `value` | `ffill()` after `replace`, or a dict | |
| `DataFrameGroupBy.grouper`, `.dtypes`, `Grouper.ax` | none (internal) | |
| `is_categorical_dtype` & co. (deprecated) | `isinstance(dtype, pd.CategoricalDtype)` | still works in 3.1 with `Pandas4Warning` |

The full list with grep patterns: [references/migration-2-to-3.md](references/migration-2-to-3.md).

## 9. Other 3.x details worth knowing

- `NaN` produced by arithmetic in nullable float dtypes (`Float64`, `float64[pyarrow]`) is now
  `<NA>`: `pd.Series([0.0], dtype="Float64") / 0` is `<NA>` and `isna()` is True.
- New in 3.0: `pd.col("x")` expressions in `assign`, `loc` and getitem
  (`df.assign(total=pd.col("price") * pd.col("qty"))`). New in 3.1: `DataFrame.select(...)` and
  `filter(cond=...)` with masks or `pd.col` expressions.
- Deprecations that will break in 4.0 (`Pandas4Warning`). From 3.1: `.values` on tz-aware,
  period and interval data (use `.array` or `.to_numpy()`; for UTC `datetime64` use
  `ser.dt.tz_convert(None).to_numpy()`), `infer_freq` returning strings, `Timestamp.dayofweek`/
  `dayofyear`/`daysinmonth` (use `day_of_week` ...), `.at` with a new key. From 3.0:
  `Timestamp.utcnow()` (use `Timestamp.now("UTC")`) and `utcfromtimestamp()`.
- `read_csv(dtype="category")` infers numeric categories in 3.1: zero-padded codes lose their
  zeros. Read as `dtype="str"` and convert.
- `Timedelta.total_seconds()` includes nanoseconds since 3.1.

## 10. Upgrading a codebase from pandas 2.x

1. Upgrade to 2.3.x first if you can and fix its `FutureWarning`s; they cover chained assignment,
   `observed`, `Series.view`, offset aliases and most removals.
2. Bump to 3.x and run the tests with the 3.x signals as errors. Pass the filters to pytest, not
   to the interpreter (pytest resets `python -W` filters for each test):
   `python -m pytest -W error::pandas.errors.ChainedAssignmentError -W error::pandas.errors.Pandas4Warning`,
   or `filterwarnings = ["error::pandas.errors.ChainedAssignmentError"]` in the pytest config.
   Fix each hit with the tables above.
3. Grep for what produces no error at all:
   `rg -n "astype\(.(int64|i8)|\.view\(|10\*\*(6|9)|1e9|1e6|== ?object|is_object_dtype|inplace=True|groupby\(|pivot_table\(|pct_change\(|\.stack\(|agg\((sum|max|min|len)\b|astype\(str\)" src`
4. For each datetime-to-number conversion, rewrite with the section 5 recipes. For each
   categorical `groupby`/`pivot_table`, decide whether empty groups must appear.
5. Prove the outputs did not change: run the old and new versions on the same input and diff
   every column, not just shapes. Keep a pandas 2.3 virtualenv around for the comparison
   (`uv venv -p 3.13 old && uv pip install -p old pandas==2.3.3`). Tests that only check columns,
   dtypes and row counts pass with every bug in section 2.
6. Don't "fix" an upgrade by pinning `pandas<3`, setting `future.infer_string=False`, casting
   everything to `object`, or silencing `ChainedAssignmentError`.

## 11. Anti-patterns

| Don't | Do |
| --- | --- |
| `df["c"][df["c"] < 0] = 0` | `df.loc[df["c"] < 0, "c"] = 0` or `df["c"] = df["c"].clip(lower=0)` |
| `df["c"].fillna(x, inplace=True)` | `df["c"] = df["c"].fillna(x)` |
| mutate the frame a caller passed in | `out = df.copy()` or `df.assign(...)` |
| `df.copy()` after every step "to avoid the warning" | nothing: results are already independent |
| `ts.astype("int64") // 10**9` | `(ts - EPOCH) // pd.Timedelta(seconds=1)` |
| `[c for c in df if df[c].dtype == object]` | `df.select_dtypes(include=["str", "object"]).columns` |
| `resample("M")` -> `resample("MS")` | `resample("ME")` keeps month-end labels |
| `.agg(sum)` | `.agg("sum")` |
| `groupby(cat)` and assuming all categories appear | `groupby(cat, observed=False)` |
| `s.to_numpy()` then write into it | `s.to_numpy(copy=True)` |

## References

- [Copy-on-Write: rules, cases, upgrade checklist](references/copy-on-write.md)
- [The str dtype: behaviour table, pyarrow vs python storage, serialising](references/string-dtype.md)
- [Datetime resolution: units, epoch and duration recipes, interop](references/datetime-resolution.md)
- [Migration from 2.x: removals, aliases, deprecations, grep patterns](references/migration-2-to-3.md)
- [Sources and what was run](references/sources.md)
