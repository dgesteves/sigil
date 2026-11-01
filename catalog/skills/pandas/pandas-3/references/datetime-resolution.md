# Datetime and timedelta resolution in pandas 3

pandas 2 converted nearly everything to nanoseconds. pandas 3 infers a unit (`s`, `ms`, `us` or
`ns`) and keeps it through arithmetic. All values below were printed on pandas 3.1.0.

## What unit you get

| Input | pandas 2.x | pandas 3.1 |
| --- | --- | --- |
| `pd.to_datetime(["2026-03-01 12:00"])` | `datetime64[ns]` | `datetime64[us]` |
| `pd.to_datetime(["2026-03-01 12:00:01.123456789"])` | `ns` | `ns` (precision requires it) |
| `pd.read_csv(..., parse_dates=[...])` | `ns` | `us` |
| `pd.to_datetime(s, utc=True)` on ISO strings with `Z` | `datetime64[ns, UTC]` | `datetime64[us, UTC]` |
| `pd.Series([datetime.datetime(...)])` | `ns` | `us` |
| `pd.Series([np.datetime64("2026-01-01", "ms")])` (list of scalars) | `ns` | `ms` |
| a NumPy `datetime64[ms]` array | `ms` | `ms` |
| a NumPy `datetime64[D]` array | `s` | `s` (closest supported unit) |
| `pd.to_datetime([1772366400], unit="s")` | `ns` | `us` (3.0 gave `s`) |
| `pd.to_timedelta([1, 2], unit="s")` | `ns` | `us` (3.0 gave `s`) |
| `pd.date_range("2026-01-01", periods=3)` | `ns` | `us` |
| `pd.Timestamp("2026-01-01").unit`, `pd.Timestamp.now().unit` | `ns` | `us` |
| `pd.Timedelta(seconds=1).unit` | `ns` | `us` |
| `int_series.astype("datetime64[ms]")` | `ms` | `ms` (the unit you ask for) |
| us column minus ns column | `ns` | `ns` (finer unit wins) |

Integers are interpreted with `unit=` as before; only the stored resolution changed. In 3.1 the
result is `us` unless the input needs `ns`.

## The 1000x bugs

Anything that reads the stored integers assumes a unit:

```python
started = pd.to_datetime(pd.Series(["2026-03-01 12:00:00", "2026-03-01 12:00:05"]))
started.astype("int64").tolist()            # [1772366400000000, 1772366405000000]  (microseconds)
(started.astype("int64") // 10**9).tolist() # [1772366, 1772366]  -> wrong, should be epoch seconds
started.diff().fillna(pd.Timedelta(0)).astype("int64").tolist()  # [0, 5000000]  (us, not ns)
```

The same applies to `ser.values.astype("int64")`, `ser.to_numpy().view("i8")`,
`np.asarray(ser, dtype="int64")`, `int(np_datetime64_value)`, and to
`Series.view("int64")`, which no longer exists (pandas 2.2 recommended replacing it with
`astype`, which is exactly what yields microseconds now).

`Timestamp.value` and `Timedelta.value` are the exception: they still return **nanoseconds**
whatever the unit (`pd.Timestamp("2026-01-01").value == 1767225600000000000`), so scalar code that
used `.value // 10**6` keeps working while the same arithmetic on a column breaks.

## Unit-agnostic recipes

```python
EPOCH_UTC = pd.Timestamp("1970-01-01", tz="UTC")
EPOCH = pd.Timestamp("1970-01-01")                       # for naive columns
SECOND = pd.Timedelta(seconds=1)
MILLISECOND = pd.Timedelta(milliseconds=1)

# datetime -> epoch integer (floored, exact)
departure_ms = (flights["departs_at"] - EPOCH_UTC) // MILLISECOND
departure_s = (flights["departs_at"] - EPOCH_UTC) // SECOND

# duration -> integer seconds (floored) or float seconds
block_s = (flights["arrives_at"] - flights["departs_at"]) // SECOND
block_hours = (flights["arrives_at"] - flights["departs_at"]) / pd.Timedelta(hours=1)
block_float_s = (flights["arrives_at"] - flights["departs_at"]).dt.total_seconds()

# epoch integer -> datetime
departs_at = pd.to_datetime(flights["departs_epoch_ms"], unit="ms", utc=True)
```

- Subtracting a naive epoch from a tz-aware column raises `TypeError: Cannot subtract tz-naive
  and tz-aware`; use the epoch that matches the column.
- With missing values (`NaT`), floor division returns `float64` with NaN. Finish with
  `.astype("Int64")` to keep integers, or fill first. `astype("int64")` on a column holding `NaT`
  does not raise: it returns `-9223372036854775808` for those rows.
- `ser.dt.as_unit("ms").astype("int64")` is also correct and fast when you want a fixed unit;
  `as_unit` to a coarser unit truncates without warning (`.2509` s becomes `.250`).
- `ser.astype("datetime64[ns]")` (or `.dt.as_unit("ns")`) restores nanoseconds when an external
  API insists on them. Remember the ns range is 1677-2262.
- `Timestamp.timestamp()` gives float seconds for a scalar.

## Joining and comparing different units

- Arithmetic, comparisons and `concat` accept mixed units; the result uses the finer unit.
- `merge` and `join` match keys across units; the key column keeps the left side's unit.
- `pd.merge_asof` does not: `MergeError: incompatible merge keys [0] dtype('<M8[us]') and
  dtype('<M8[ns]'), must be the same type`. Align both keys first:
  `left["at"] = left["at"].dt.as_unit("ns")`.
- Columns get `ns` from NumPy arrays created with `ns`, strings with 7-9 fractional digits, and
  older Parquet files written as `timestamp[ns]`. Columns from CSVs, `datetime` objects and
  `date_range` get `us`. Mixing both is the common way to hit the `merge_asof` error.

## Interop

| Destination | What pandas 3 does |
| --- | --- |
| Parquet (pyarrow) | writes `timestamp[us]` / `duration[us]` and reads them back as `us`; consumers that assumed `ns` metadata now see `us` |
| `to_json()` default | epoch **milliseconds** (correct), plus a `Pandas4Warning` that ISO will become the default; pass `date_format=` explicitly |
| `to_sql` with sqlite3 | ISO text with microseconds (`'2026-05-01 10:00:00.123456'`) |
| `read_sql(..., parse_dates=[...])` | `us` |
| `.to_numpy()` | `datetime64[us]` array; `.astype("int64")` on it is microseconds |
| `.dt.to_pydatetime()` | a Series of `datetime.datetime` (it returned an ndarray before 3.0) |

## Time zones and calendar arithmetic

- Strings like `"US/Pacific"` resolve to `zoneinfo.ZoneInfo`; `"UTC"`/`Z` offsets resolve to
  `datetime.timezone.utc`. `pytz` is not a dependency any more (`pip install pandas[timezone]`
  pulls it in if you still need it); pytz objects passed explicitly still work.
- Ambiguous and non-existent local times raise `ValueError` from `tz_localize`; pass
  `ambiguous=` / `nonexistent=`.
- Mixed offsets in `to_datetime` raise unless `utc=True`.
- `pd.offsets.Day(n)` is n calendar days and keeps the wall-clock time across DST;
  `pd.Timedelta(days=n)` is n x 24 hours. `Day` no longer equals `Hour(24)` and no longer supports
  division. `resample("D")` on a local-time index produces 23-hour and 25-hour bins on DST days.
- `Timedelta.total_seconds()` includes the nanosecond part since 3.1.
- `Timedelta` strings `"1H"` and unit `"T"`: `"1H"` still parses with a deprecation warning,
  `"5T"` raises; write `"1h"` and `"5min"`.
