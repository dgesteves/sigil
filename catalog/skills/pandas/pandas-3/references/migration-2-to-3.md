# Migrating from pandas 2.x to 3.x

Removals were enforced in 3.0.0 (January 2026); 3.1.0 (October 2026) adds deprecations that
become errors in 4.0. Each "raises" entry below was reproduced on 3.1.0. Rows marked **silent**
return a different result instead of failing.

## Before you start

- Upgrade to pandas 2.3.x first and clear its `FutureWarning`s. 2.3 warns about chained
  assignment (`ChainedAssignmentError: behaviour will change in pandas 3.0!`), `Series.view`,
  `observed=False`, `'M'`/`'H'` aliases and most removals below. 3.x is silent about several of
  them.
- Keep a pandas 2.3 environment to diff outputs: `uv venv -p 3.13 .venv-pandas2 && uv pip
  install -p .venv-pandas2 pandas==2.3.3`. Run the same function on the same input under both and
  compare every column.
- pandas 3.0 requires Python >= 3.11; 3.1 requires NumPy >= 2.0.2.

## Frequency and unit aliases (raise `ValueError: Invalid frequency`)

| Removed | Replacement |
| --- | --- |
| `M`, `BM`, `SM`, `CBM` | `ME`, `BME`, `SME`, `CBME` |
| `Q`, `BQ` | `QE`, `BQE` |
| `Y`, `BY` | `YE`, `BYE` |
| `A`, `A-DEC`, `BA` | `YE`, `YE-DEC`, `BYE` |
| `AS`, `BAS` | `YS`, `BYS` |
| `H`, `BH`, `CBH` | `h`, `bh`, `cbh` |
| `T`, `L`, `U`, `N` | `min`, `ms`, `us`, `ns` |

- These apply to offsets: `resample`, `date_range`, `pd.Grouper(freq=)`, `dt.floor/ceil/round`,
  `asfreq`, `rolling("...")` windows.
- **Periods keep the old letters**: `to_period("M")`, `period_range(freq="Q")`; `to_period("ME")`
  raises `for Period, please use 'M' instead of 'ME'`.
- Replace `M` with `ME`, not `MS`: `MS` moves every label to the first of the month.
- Deprecated (warn, still work): lowercase `d`, `w`, `w-mon`, `b`, `c`; `Timedelta` units `w`,
  `d`, `MIN`, `MS`, `US`, `NS`, and `H` in `Timedelta("1H")`. `Timedelta("5T")` raises.

## Removed methods and arguments (raise)

| Removed | Replacement | Note |
| --- | --- | --- |
| `DataFrame.applymap`, `Styler.applymap` | `DataFrame.map`, `Styler.map` | element-wise, like before |
| `fillna(method="ffill"/"bfill")` (frames, Series, groupby, resample) | `.ffill()`, `.bfill()` | `groupby(...).ffill()` |
| `DataFrameGroupBy.fillna`, `Resampler.fillna` | `.ffill()`/`.bfill()`/`.fillna(value)` on the result | |
| `Series.first(offset)`, `Series.last(offset)`, `DataFrame.first/last` | boolean mask on the index (below) | |
| `Series.view(dtype)` | `astype`, but for datetimes use the epoch recipes | `astype("int64")` gives the column's unit |
| `Series.ravel()` | `ser.to_numpy().ravel()` | |
| `Series.bool()`, `DataFrame.bool()` | `bool(ser.item())` | |
| `swapaxes` | `transpose()` / `.T` | |
| `pd.value_counts(x)` | `pd.Series(x).value_counts()` | |
| `int(ser)`, `float(ser)` | `int(ser.iloc[0])`, `ser.item()` | |
| `Index.format()` | `index.astype(str)` or `index.map(fmt)` | |
| `Index.is_boolean()`, `is_integer()`, `is_floating()`, `is_numeric()`, `is_object()`, `is_categorical()`, `is_interval()`, `holds_integer()` | `pd.api.types.is_bool_dtype(index)` etc. | |
| `pandas.api.types.is_interval`, `is_period` | `isinstance(x, pd.Interval)` / `pd.Period` | |
| `read_csv(delim_whitespace=True)` | `sep=r"\s+"` | |
| `read_csv(date_parser=...)` | `date_format="%Y-%m-%d ..."` or `to_datetime` after reading | |
| `read_csv(infer_datetime_format=...)`, `keep_date_col=`, `verbose=` | drop the argument | strict inference is the default |
| `read_csv(parse_dates=[["date", "time"]])` (combining columns) | `pd.to_datetime(df["date"] + " " + df["time"])` | |
| `read_json(text)`, `read_html(text)`, `read_xml(text)`, `read_excel(bytes)` with literal data | wrap in `io.StringIO` / `io.BytesIO` | a literal string is treated as a path |
| `to_datetime/to_timedelta/to_numeric(errors="ignore")` | `errors="coerce"` and handle NaN/NaT | |
| `Series.replace(..., method=, limit=)`, `replace(to_replace)` without `value` | explicit `value`, then `ffill()` | |
| `groupby(..., axis=1)`, `rolling(axis=)`, `resample(axis=)` | transpose first | |
| `resample(kind=...)` | `.to_period()` / `.to_timestamp()` on the result | |
| `groupby(...).apply(f, include_groups=True)` | grouping columns are never passed to `f` | select them explicitly |
| `stack(dropna=...)`, `stack(future_stack=False)` | `stack()` then `.dropna()` | new stack keeps NaN |
| `DataFrame.from_records(df)` | the DataFrame itself | |
| `read_parquet(use_nullable_dtypes=True)` | `dtype_backend="numpy_nullable"` | |
| `read_gbq`, `to_gbq` | `pandas_gbq` package | |
| `mode.use_inf_as_na` option | `df.replace([np.inf, -np.inf], np.nan)` | |
| `DataFrame.append` (removed in 2.0, still common in old code) | `pd.concat([df, other])` | |

Faithful replacement for `first("3D")` on a sorted DatetimeIndex: it kept every label before
`first label + 3 days` (and `last("3D")` every label after `last label - 3 days`).

```python
head_window = ser[ser.index < ser.index[0] + pd.Timedelta(days=3)]
tail_window = ser[ser.index > ser.index[-1] - pd.Timedelta(days=3)]
```

`ser.loc[: ser.index[0] + pd.Timedelta(days=3)]` also keeps a label exactly 3 days later, and
`head(3)` counts rows, not days. For month or year offsets (`first("1ME")`), check the old
implementation's anchoring before porting.

## Indexing behaviour that changed

- `ser[i]` with an integer is always a label lookup (`KeyError` on a DatetimeIndex or string
  index). Use `ser.iloc[i]`.
- An integer slice on a float index is positional.
- Logical operations between pandas objects and plain lists or tuples (`ser & [True, False]`)
  raise `TypeError`; wrap the list in `pd.Series` or `np.array`.
- Setting incompatible values no longer upcasts silently (PDEP-6): `TypeError: Invalid value`.
- Constructors no longer infer dtypes when given pandas objects: `pd.Series(obj_index)` keeps
  `object`; call `.infer_objects()`.

## Silent changes (no error, different result)

| Change | Old result | New result | Keep the old result with |
| --- | --- | --- | --- |
| **silent** Copy-on-Write | chained assignment and `df[col].method(inplace=True)` updated `df` | no-op + warning | `df.loc[...] = ...`, `df[col] = df[col].method()` |
| **silent** default `str` dtype | text was `object` | `str` | dtype checks that accept `str` |
| **silent** datetime unit inference | `ns` | `us` (usually) | unit-agnostic epoch/duration math |
| **silent** `groupby`/`pivot_table` `observed` default | `False` | `True` | `observed=False` |
| **silent** `pct_change()` | forward-filled NaN first (`fill_method="pad"`) | no fill | `ser.ffill().pct_change()` |
| **silent** `stack()` | dropped all-NaN rows | keeps them | `.stack().dropna()` |
| **silent** `agg(sum)`, `agg(max)`, `agg(min)` with Python builtins | swapped for the pandas method (skips NaN) | builtin called as-is: NaN in a group gives NaN | string names (`"sum"`); NumPy functions such as `np.sum` dispatch to the pandas method and still skip NaN |
| **silent** `astype(str)` | NaN -> `"nan"` | NaN stays | `fillna("")` first |
| **silent** `DataFrame.value_counts(sort=False)` | sorted by labels | input order | `sort_index()` |
| **silent** `concat` of DatetimeIndex objects with `sort=False` | sorted anyway | not sorted | `sort=True` |
| **silent** `pd.offsets.Day` | 24 hours | calendar day | `pd.Timedelta(days=1)` for 24h |
| **silent** nullable float arithmetic | `0/0` gave NaN (not missing) | `<NA>` (missing) | n/a |
| **silent** `read_csv(dtype="category")` (3.1) | string categories | numeric/bool categories | `dtype="str"` then `.astype("category")` |
| **silent** `Series.dt.to_pydatetime()` | ndarray | Series | `.to_numpy()` |
| **silent** `concat` with empty or all-NA frames | ignored for the result dtype | taken into account | drop empties first |
| **silent** `inplace=True` return value | `None` | the object (for methods that keep `inplace`) | n/a |
| **silent** `Index.join` with different dtypes (3.1) | common dtype such as `object` | dtype of the side the result is taken from | n/a |

## 3.1 deprecations (warn with `Pandas4Warning`, break in 4.0)

- `inplace=` on `drop`, `rename`, `rename_axis`, `reset_index`, `set_index`, `dropna`,
  `drop_duplicates`, `sort_values`, `sort_index`, `eval`, `query`.
- `.values` on tz-aware, period and interval Series/Index: use `.array`, `.to_numpy()`, or
  `ser.dt.tz_convert(None).to_numpy()` for UTC `datetime64`.
- `infer_freq`, `inferred_freq`, `Series.dt.freq` returning strings (they will return offsets);
  opt in with `pd.set_option("future.infer_freq_returns_offset", True)`.
- `Timestamp.dayofweek`, `dayofyear`, `daysinmonth`, and `weekday` on DatetimeIndex/Period:
  use `day_of_week`, `day_of_year`, `days_in_month`.
- Setting with `.at` on a missing key (use `.loc`), `select_dtypes` matching `str` when given
  `object` in `include` or `exclude`, `future.infer_string`, `mode.chained_assignment`,
  `DataFrame.join(lsuffix=, rsuffix=)` (use `suffixes=`), `read_csv(float_precision=)`,
  `read_json(convert_dates=, keep_default_dates=)`, integers passed to `Period`/`period_range`,
  quarterly strings like `"2014Q2"` in `to_datetime`.

## 3.0 deprecations still pending

`Timestamp.utcnow()` (use `Timestamp.now("UTC")`), `Timestamp.utcfromtimestamp(x)` (use
`Timestamp.fromtimestamp(x, "UTC")`), `is_categorical_dtype` and friends (use `isinstance(dtype,
pd.CategoricalDtype)`), the `copy=` keyword on many methods, `Series.map(arg=)` (use `func=`),
positional arguments to reductions (`df.sum(0)` -> `df.sum(axis=0)`), `to_json(date_format="epoch")`
as the default.

## Grep patterns

```sh
# removed APIs and aliases (fail loudly, but find them all at once)
rg -n "applymap|fillna\(method|\.first\(|\.last\(|\.view\(|swapaxes|\.ravel\(|\.bool\(\)|pd\.value_counts|delim_whitespace|date_parser|infer_datetime_format|errors=.ignore|include_groups|future_stack|\.append\(" src
rg -n "(resample|date_range|Grouper|floor|ceil|round|asfreq)\(.*[\"'][0-9]*(M|Q|Y|A|H|T|S|L|U|N|BM|BQ|BY|BA|AS|BAS|BH|CBH|SM|CBM)(-[A-Z]{3})?[\"']" src
# silent ones (read each hit)
rg -n "astype\(.(int64|i8)|\.values\.astype|10\*\*(6|9)|1e9|1e6|\.value\b" src
rg -n "== ?object|is_object_dtype|select_dtypes\(|inplace=True|\]\[.*\] *=[^=]" src
rg -n "groupby\(|pivot_table\(|pct_change\(|\.stack\(|agg\((sum|min|max|len|np\.)|astype\(str\)" src
```
