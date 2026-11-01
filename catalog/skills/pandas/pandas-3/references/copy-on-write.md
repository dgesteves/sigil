# Copy-on-Write in pandas 3

Copy-on-Write (PDEP-7) is the only mode in pandas 3. The `mode.copy_on_write` option has no
effect (deprecated, removed in 4.0). Checked on pandas 3.1.0.

## The rule

Any object you get back from indexing or from a method **behaves as a copy** of its parent.
Under the hood pandas shares memory and copies lazily on the first write to either side, so the
rule costs nothing until you write.

| Code | pandas 2 (no CoW) | pandas 3 |
| --- | --- | --- |
| `col = df["a"]; col.iloc[0] = 100` | often changed `df` too | `df` unchanged |
| `sub = df[df["a"] > 1]; sub["b"] = 0` | `SettingWithCopyWarning`, `df` unchanged | `df` unchanged, no warning |
| `df["b"][df["a"] > 1] = 0` | usually changed `df` (warnings in 2.2+) | **`df` unchanged** + `ChainedAssignmentError` |
| `df[df["a"] > 1]["b"] = 0` | `SettingWithCopyWarning`, unchanged | unchanged + `ChainedAssignmentError` |
| `df.loc["r1"]["b"] = 0` | depended on dtypes | unchanged + `ChainedAssignmentError` |
| `df["b"].fillna(0, inplace=True)` | changed `df` (`FutureWarning` in 2.2+) | **unchanged** + `ChainedAssignmentError` |
| `df["b"].replace("x", "y", inplace=True)` | changed `df` | **unchanged** + `ChainedAssignmentError` |
| `df.loc[df["a"] > 1, "b"] = 0` | changes `df` | changes `df` |
| `df["b"] = df["b"].fillna(0)` | changes `df` | changes `df` |
| `df.fillna(0, inplace=True)` (whole frame) | changes `df`, returns `None` | changes `df`, **returns `df`** |
| `for _, row in df.iterrows(): row["b"] = 0` | unchanged | unchanged |

`ChainedAssignmentError` is a `Warning` subclass in `pandas.errors`. It is emitted, not raised,
so the program keeps running with the old values. It fires inside functions and methods as well
as at module level.

## Patterns

Update a subset of rows:

```python
readings.loc[readings["temp_c"] < -60, "temp_c"] = np.nan
readings.loc[readings["station"].isna(), "station"] = "unassigned"
```

Update a whole column with a method: assign the result back.

```python
readings["humidity"] = readings["humidity"].fillna(readings["humidity"].median())
readings["station"] = readings["station"].replace({"LIS-1": "LIS-01"})
readings["temp_c"] = readings["temp_c"].clip(lower=-60, upper=60)
```

Several columns at once without touching the input:

```python
def clean_readings(readings: pd.DataFrame) -> pd.DataFrame:
    return readings.assign(
        humidity=lambda d: d["humidity"].fillna(0),
        station=lambda d: d["station"].str.upper(),
    )
```

`update` and `where`/`mask` with `inplace=True` on the frame itself also work.

## When you still need `.copy()`

Copy-on-Write makes *derived* objects independent. It does nothing for the object you were
given. These mutate the caller's DataFrame:

```python
def bad(readings):
    readings["station"] = readings["station"].str.strip()   # replaces the caller's column
    readings.loc[readings["temp_c"] < -60, "temp_c"] = np.nan  # writes into the caller's frame
    return readings
```

If a function promises not to change its input, either build a new frame (`assign`, `pd.concat`,
returning `readings[...]` expressions) or start with `out = readings.copy()`. Under CoW that copy
is lazy, so it is cheap.

The defensive `.copy()` calls that pandas 2 code added after filtering, just to silence
`SettingWithCopyWarning`, are no longer needed: `sub = df[mask].copy()` and `sub = df[mask]`
behave the same.

## NumPy arrays

- `ser.to_numpy()`, `ser.values`, `np.asarray(ser)`, `df.to_numpy()` / `df.values` for
  single-dtype frames return **read-only views** when no copy was needed. Writing raises
  `ValueError: assignment destination is read-only`. Use `to_numpy(copy=True)` for a writable
  array.
- Mixed-dtype frames produce a new array for `.values`, which is writable but never linked to the
  frame.
- `Index.values` and `Index.array` are read-only for every dtype since 3.1.
- Writing into an array you got from pandas never changes the pandas object. Write through
  pandas (`.loc`, `.iloc`) instead.

## inplace in 3.x

- Methods that can genuinely modify data (`fillna`, `replace`, `ffill`, `bfill`, `interpolate`,
  `where`, `mask`, `clip`, `update`) keep `inplace=`. Since 3.0 they return the object when
  `inplace=True`.
- 3.1 deprecates `inplace=` (with `Pandas4Warning`) where it was always "compute a new object and
  rebind": `drop`, `rename`, `rename_axis`, `reset_index`, `set_index`, `dropna`,
  `drop_duplicates`, `sort_values`, `sort_index`, `eval`, `query`. Write `df = df.dropna()`.
- The `copy=` keyword of `astype`, `rename`, `reindex`, `merge`, `align`, `set_axis`,
  `transpose`, `tz_localize`, `tz_convert`, `infer_objects`, `to_period`, `to_timestamp`,
  `truncate`, `swaplevel`, `reindex_like` is deprecated and has no effect.

## Setting values that don't fit the dtype

PDEP-6 is enforced: setting a value that would silently upcast raises `TypeError`.

```python
counts = pd.Series([1, 2, 3])
counts.iloc[0] = 1.5      # TypeError: Invalid value '1.5' for dtype 'int64'
counts.iloc[0] = None     # allowed: int becomes float64 with NaN
labels = pd.Series(["a", "b"])
labels.iloc[0] = 5        # TypeError: Invalid value '5' for dtype 'str'
```

Cast the column first (`counts = counts.astype("float64")`) when the change is intended.

## Upgrade checklist

1. `rg -n "inplace=True" src` and look at the receiver: a column (`df["x"].…`) or attribute
   (`df.x.…`) receiver never works in 3.x.
2. `rg -n '\]\[.*\] *=[^=]' src` finds `df[a][b] = v` and `df.loc[i][c] = v` assignments
   (and some harmless dict writes).
3. Run the test suite with
   `python -m pytest -W error::pandas.errors.ChainedAssignmentError`. pytest resets interpreter
   `-W` options per test, so pass the filter to pytest (or put it in `filterwarnings`).
4. Delete `.copy()` calls that only existed to silence `SettingWithCopyWarning`; keep the ones
   that protect a caller's input.
5. Grep for writes into `.values` / `.to_numpy()` results.
