# The default `str` dtype (PDEP-14)

Since pandas 3.0, text is inferred as `pd.StringDtype(na_value=np.nan)`, printed as `str`, instead
of NumPy `object`. Checked on pandas 3.1.0 with storage `python` (no pyarrow) and `pyarrow`
(pyarrow 26.0.0); the results below are the same for both unless noted.

## Where it comes from

- Constructors: `pd.Series(["a", None])`, `pd.DataFrame({"s": [...]})`, `pd.Index(["a"])`.
- Readers: `read_csv`, `read_json`, `read_parquet`, `read_sql`, `read_excel` ...
- `dtype=str` and `astype(str)` give the same `str` dtype.
- Mixed content (`["a", 1]`) stays `object`. An all-missing column read from CSV is `float64`.
- `dtype="string"` (or `pd.StringDtype()`) is the older opt-in string dtype with `pd.NA` as the
  missing value. It still exists and behaves as before; it is a different dtype from `str`.

The dtype repr shows the storage: `<StringDtype(storage='python', na_value=nan)>` without
pyarrow, `<StringDtype(na_value=nan)>` (storage `pyarrow`) with it. `ser.dtype.storage` tells you
which. Regex methods on pyarrow storage briefly differed from Python's `re` in 3.0 (`\w` ASCII
only, `$` before a trailing newline); 3.1 aligns them with `re` again.

## Behaviour table

| Operation | pandas 2 (object) | pandas 3 (`str`) |
| --- | --- | --- |
| `ser.dtype == object` | `True` | `False` |
| `ser.dtype == "str"` | `False` | `True` |
| `pd.api.types.is_object_dtype(ser)` | `True` | `False` |
| `pd.api.types.is_string_dtype(ser)` | `True` only if every value is a `str` (no `None`) | `True` |
| `isinstance(ser.dtype, pd.StringDtype)` | `False` | `True` |
| `ser.dtype.kind` | `"O"` | `"O"` (don't use it to tell text apart) |
| `select_dtypes(include="object")` | text columns | text columns **plus** a deprecation warning |
| `select_dtypes(include=["str", "object"])` | n/a | text and other object columns, no warning |
| `select_dtypes(exclude="object")` | drops text | drops text, with a deprecation warning (3.1); use `exclude=["str", "object"]` |
| `pd.Series(["a", None]).iloc[1]` | `None` | `nan` |
| `.astype(object)` on `str` data | n/a | missing values stay `nan` (not `None`) |
| `.astype(str)` with missing values | `"nan"` / `"None"` text | missing stays missing |
| `.apply(str)` / `.map(str)` | `"nan"` | `"nan"` (unchanged) |
| `ser.iloc[0] = 5` | allowed | `TypeError: Invalid value '5' for dtype 'str'` |
| `.str.len()` with missing | `float64` | `float64` |
| `.str.contains("a")` with missing | `object` holding the missing value (cannot mask) | `bool`, missing -> `False` |
| `ser == "a"` with missing | `False` | `False` |
| `ser + "!"` with missing | NaN | NaN |
| `.to_dict()`, `.tolist()` | `None` if the data held `None` | `nan` |
| `value_counts().index.dtype` | `object` | `str` |

## Finding text columns

```python
text_columns = frame.select_dtypes(include=["str", "object"]).columns
# or, per column
from pandas.api.types import is_string_dtype
text_columns = [c for c in frame.columns if is_string_dtype(frame[c])]
```

For an `object` column, `is_string_dtype(ser)` inspects the values (`False` as soon as one is
`None` or not a `str`), while `is_string_dtype(ser.dtype)` is `True` for any `object` dtype.
Prefer `select_dtypes` with both names when hand-built `object` columns may appear.

## Cleaning text

```python
stations = frame["station"].str.strip().str.replace(r"\s+", " ", regex=True)
frame["station"] = stations.mask(stations == "")         # blank -> missing (NaN)
```

- `.str.replace` treats the pattern literally unless `regex=True` (since pandas 2.0).
- `replace("", np.nan)` and `replace("", None)` both give `nan` on a `str` column.
- `.str` accessors raise `AttributeError: Can only use .str accessor with string values` on an
  all-NaN `float64` column; guard with the dtype check above.

## Serialising missing values

`nan` is not valid JSON. `json.dumps` writes `NaN`, and strict consumers reject it. Before
building JSON by hand from `to_dict()`, convert missing values:

```python
payload = frame.astype(object).where(frame.notna(), None).to_dict(orient="records")
```

`DataFrame.to_json()` already writes `null` for missing values.

## Things that no longer matter

- `.astype(object)` before string work: unnecessary and slower; it also turns off the `str`
  semantics (setitem checks, bool results from `.str.contains`).
- `pd.options.future.infer_string`: on by default since 3.0, deprecated in 3.1, and in 4.0 it
  cannot be turned off. Don't set it to `False` to "fix" an upgrade.
- `pd.options.mode.string_storage` picks `python` or `pyarrow` storage for `dtype="string"`.
