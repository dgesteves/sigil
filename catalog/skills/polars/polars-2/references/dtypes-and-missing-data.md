# Dtypes, nulls, NaN, casting and parsing

Checked on polars 2.1.0.

## Null and NaN

`null` is Polars' only missing value, for every dtype. `NaN` exists only in Float32/Float64 and is
a value.

| Expression on `pl.Series([1.0, nan, None, 3.0])` | Result |
| --- | --- |
| `mean()`, `sum()`, `std()`, `var()` | `nan` |
| `median()` on `[1.0, nan, 2.0]` | `2.0` |
| `min()`, `max()` | `1.0`, `3.0`; `nan` only when every non-null value is NaN |
| `nan_min()`, `nan_max()` | propagate NaN |
| `count()` | `2` (non-null values, NaN counted) |
| `len()` | `4` |
| `null_count()` | `1` |
| `is_null()` | `[False, False, True, False]` |
| `is_nan()` | `[False, True, None, False]` |
| `fill_null(0)` | `[1.0, nan, 0.0, 3.0]` |
| `fill_nan(None)` | `[1.0, None, None, 3.0]` |
| `drop_nulls()` / `drop_nans()` | removes only nulls / only NaNs |
| `cum_sum()` | NaN from the first NaN on, null stays null |
| `== float("nan")` | `True` for the NaN (Polars treats NaN == NaN) |
| `n_unique()` on `[nan, nan, None]` | `2` |

Where NaN comes from: the text `NaN`/`nan` in CSV and JSON float columns, `0.0 / 0.0`, and NumPy
input. `pl.from_pandas` converts NaN to null by default (`nan_to_null=True`); `pl.Series(ndarray)`
keeps NaN unless you pass `nan_to_null=True`.

Pick one rule at the boundary and apply it once:

```python
FLOW_COLUMNS = ["flow_lpm", "pressure_kpa"]

meters = pl.scan_csv("meters.csv", null_values=["NaN", "nan", ""])   # option 1: read as null
meters = pl.scan_csv("meters.csv").with_columns(pl.col(FLOW_COLUMNS).fill_nan(None))  # option 2
```

- Aggregating after that is plain: `mean()`, `min()`, `count()` skip nulls; a group with no valid
  values gets null statistics and `count() == 0`.
- Don't `filter(~pl.col(c).is_nan())` on one column of a multi-measurement row: you also drop the
  other measurements and can lose whole groups.
- `pl.col(c).is_not_null().sum()` and `pl.col(c).count()` are the same count after the conversion.

## Reading CSV

- `null_values`: a string, a list, or a `{column: value}` dict. An empty unquoted field is null in
  every column; a quoted `""` stays an empty string in a String column
  (`empty_string_is_null=True` is the default; it replaced `missing_utf8_is_empty_string`, with the
  opposite meaning).
- `schema=` replaces inference completely and is matched to the header **by name** (2.0); extra
  or missing file columns raise unless `extra_columns="ignore"` / `missing_columns="insert"`.
  `schema_overrides=` fixes some columns and infers the rest (a list must cover every column).
- `try_parse_dates=True` parses ISO-looking date and datetime columns; a `Z` or offset gives a UTC
  `Datetime`.
- `infer_schema_length` (rows, default 100) and `infer_schema_files` (files, default 10) bound
  inference; long files with a late odd value need `schema_overrides` or a larger length.
- Headerless files get `column_0`, `column_1`, ... (2.0); pass `new_columns=[...]`.
- `columns=[...]` returns the columns in the order you list them (2.0).

## Strings to dates and times

```python
when = pl.col("logged_at")
df.with_columns(
    when.str.to_datetime("%Y-%m-%d %H:%M:%S", time_zone="Europe/Lisbon").alias("local"),
    when.str.to_datetime("%Y-%m-%dT%H:%M:%SZ", time_zone="UTC").alias("utc"),  # literal Z: say UTC
    pl.col("issued_on").str.to_date("%d/%m/%Y"),
)
```

- `cast(pl.Date)` / `cast(pl.Datetime)` on String was removed in 2.0; use `str.to_date`,
  `str.to_datetime`, `str.to_time` or `str.strptime(dtype, fmt)`.
- Without `format`, Polars infers one format from the data and raises on values that don't match
  it (`"2024-01-02"` and `"02/01/2024"` in one column raise). `strict=False` turns failures into
  nulls; count them.
- A format with a literal `Z` gives a naive datetime unless you pass `time_zone="UTC"`.
- `dt.replace_time_zone(tz)` labels naive values; `dt.convert_time_zone(tz)` converts aware ones.
  `dt.date()` returns the date in the column's own zone.
- Local wall-clock times can fall in a DST gap or overlap. Parsing with `time_zone=` raises on
  both by default; `ambiguous="earliest"|"latest"|"null"` is accepted by `str.to_datetime`, and for
  gaps parse naive, then `dt.replace_time_zone(tz, non_existent="null", ambiguous=...)`.
- Datetimes default to microseconds (`Datetime("us")`), also for `%f`/`%.f`; pass
  `time_unit="ns"` when you need nanoseconds.

## Casting

- `cast` is strict: a value that doesn't convert raises `InvalidOperationError` naming the column
  and the bad values. `cast(dtype, strict=False)` makes them null.
- Prefer the typed parsers: `str.to_integer(base=10, strict=...)`, `str.to_decimal(scale=...)`
  (keyword-only arguments in 2.0).
- Removed in 2.0: String → Date/Datetime/Time, integer ↔ Categorical/Enum (`cat.to`,
  `cat.physical`), scalar → List (`pl.list`), struct casts that drop or rename fields under
  `strict=True`, Boolean with integer in `&`/`|`.
- Mixed String/number arithmetic raises (2.1): cast first.
- Int64 with UInt64 resolves to `Int128` (exact) instead of Float64. Int128 round-trips through
  Parquet, but `to_arrow()`, `to_pandas()` (pyarrow 26) and `to_numpy()` raise on it: cast to Int64
  or Float64 before handing the frame to other libraries.
- `Decimal` rounding (`round`, `ceil`, `floor`, `sign`) widens precision by one in 2.0; sums are
  `Decimal(38, s)`.

## Membership and comparisons

- `is_in(values)` only coerces when that is lossless. `int_col.is_in([1.5])` and even
  `int_col.is_in([1.0])` raise; cast one side. Datetime needles are converted to the values' time
  unit; naive versus aware raises.
- String needles against an `Enum` treat unknown labels as absent instead of raising.
- `list.contains`, `arr.contains` follow the same rules.

## Categoricals and Enums

- `pl.Enum([...])` for a fixed set of labels (validated, ordered by declaration);
  `pl.Categorical` for open sets. Categoricals have no local/global scope any more; ordering is
  lexical.
- `cast(pl.Enum(labels))` on strings raises on unknown labels; use `replace_strict` first to map
  them.

## Nested types

- `list.eval(pl.element()...)` runs an expression per list; `list.len()`, `list.get(i,
  null_on_oob=True)`, `list.contains`, `list.set_intersection`.
- `explode` of an empty list gives no row in 2.0 (`empty_as_null=True` for one null row);
  `keep_nulls=False` also drops null lists.
- `list.to_struct(fields)` needs the field names; a null list becomes a null struct.
- Map columns from Arrow/Parquet load as `pl.Map(key, value)` in 2.0 (they were
  `List(Struct(key, value))`); `map.entries()` gives the old shape.
