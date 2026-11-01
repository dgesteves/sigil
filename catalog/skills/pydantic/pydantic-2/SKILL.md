---
name: pydantic-2
description: Write, review and migrate Pydantic 2 models (checked against pydantic 2.14.2 on Python 3.14) for request bodies, webhooks, API responses and database rows. Covers Pydantic 1 habits that still run on 2.x but change behaviour (Optional without a default is required, defaults skip validators, renamed Config keys are ignored, "Value error, " prefixed messages, numbers no longer coerced to str), field and model validators, aliases (validate_by_name, serialization_alias), JSON that differs from v1 (Decimal as a string, UTC as Z, timedelta as ISO 8601, subclass fields dropped), computed and excluded fields, MISSING for PATCH, and safe error bodies. Use when code imports pydantic, when adding validation to an API or webhook, when JSON output must match a contract, when a pydantic upgrade breaks tests, or when you see v1 idioms like class Config, @validator, @root_validator, .dict(), parse_obj, from_orm, __root__ or Field(regex=...).
license: MIT
---

# Pydantic 2

Pydantic 2 is the only maintained line (`pydantic==2.14.2`, `pydantic-core==2.50.2`, October 2026).
A lot of Pydantic 1 code still imports and runs on 2.x through deprecation shims, and a lot of model
training data is Pydantic 1, so the dangerous mistakes are the ones that run: a key that is
suddenly required, a default that skips its validator, a JSON number that becomes a string. Every
behaviour below was run against 2.14.2; the v1 comparisons against 1.10.26.

## 1. Check what is installed

```sh
python -c "import pydantic, pydantic_core; print(pydantic.VERSION, pydantic_core.__version__)"
```

| You see | Write |
| --- | --- |
| `2.x` | the v2 API below: `model_config`, `field_validator`, `model_dump`, `model_validate` |
| `2.x` and `from pydantic.v1 import ...` | legacy code on the bundled v1 copy (1.10.27 in 2.14, works on 3.14 again since 2.13). Port it; don't add new v1 code |
| `1.10.x` | match the repo, or upgrade deliberately (section 9) |

`BaseSettings` lives in `pydantic-settings`, and `Color`/payment cards in `pydantic-extra-types`.

## 2. Required, optional and defaults

| Annotation | Meaning in v2 | v1 meaning |
| --- | --- | --- |
| `name: str` | required, not `None` | same |
| `nickname: str \| None` (or `Optional[str]`) | **required**, may be `None` | optional, default `None` |
| `email: str \| None = None` | optional, default `None` | same |
| `extras: Any` | **required** | optional, default `None` |
| `extras: Any = None` | optional | same |

- **Any key a client may omit needs an explicit default.** `x: Optional[int] = Field(alias="x")`
  with no default is required in v2.
- **Defaults are not validated.** A `field_validator` does not run when the default is used, unless
  the field has `Field(default, validate_default=True)` (v1's `@validator(..., always=True)`).
- Mutable defaults (`tags: list[str] = []`) are safe: Pydantic copies them per instance.
  `Field(default_factory=lambda data: data["starts"])` can read already-validated fields.
- `model_copy(update=...)` and `model_construct(...)` do **not** validate. To re-validate an edit:
  `Model.model_validate({**obj.model_dump(), **changes})`.

## 3. Validators

```python
class Booking(BaseModel):
    venue: str
    starts: date
    ends: date
    currency: str = Field("eur", validate_default=True)   # validator also runs on the default
    tags: list[str] = []

    @field_validator("currency")                  # mode="after" (default): input already a str
    @classmethod
    def upper(cls, v: str) -> str:
        return v.upper()

    @field_validator("tags", mode="before")       # raw input, any type: v1's pre=True
    @classmethod
    def split(cls, v: Any) -> Any:
        return v.split(",") if isinstance(v, str) else v

    @model_validator(mode="after")                # instance method, must return self
    def dates_in_order(self) -> "Booking":
        if self.ends < self.starts:
            raise ValueError("ends before it starts")
        return self
```

- `field_validator` modes: `after` (default, typed value), `before` (raw input), `plain` (replaces
  type validation), `wrap` (calls `handler`). The same as `Annotated[str, AfterValidator(f)]`,
  `BeforeValidator`, `PlainValidator`, `WrapValidator`, which also work per item:
  `list[Annotated[str, AfterValidator(str.lower)]]` replaces v1's `each_item=True`.
- `info: ValidationInfo` gives `info.data` (fields validated so far, in definition order; a field that
  failed is absent), `info.field_name`, `info.context`. v1's `values`, `field`, `config` are gone.
- `model_validator(mode="before")` receives whatever was passed (a dict, an ORM object, a string,
  `None`): check the type before indexing. `mode="after"` as a classmethod is deprecated since 2.12;
  returning anything but `self` warns.
- **Model "after" validators run only when every field passed.** Same as v1's
  `@root_validator(skip_on_failure=True)`. A form that must show a cross-field error next to field
  errors needs a field validator on the later field that reads `info.data` (check the other key is
  present). A `before` model validator that raises stops validation and hides the field errors.
- `TypeError` raised in a validator is not converted into a `ValidationError`; it propagates.

### Messages

| Raised in a validator | `msg` in `errors()` | `type` |
| --- | --- | --- |
| `ValueError("venue is closed")` | **`Value error, venue is closed`** | `value_error` |
| `AssertionError` / `assert` | `Assertion failed, ...` (and `-O` strips asserts) | `assertion_error` |
| `PydanticCustomError("venue_closed", "{venue} is closed", {"venue": v})` | `closed-hall is closed` | `venue_closed` |

v1 used the bare `ValueError` text. When a message reaches clients verbatim (a 422 body, a form),
raise `PydanticCustomError` (from `pydantic_core`), or strip the prefix where you build the
response. Default messages changed wording too (`field required` is now `Field required`, types like
`value_error.missing` are now `missing`); don't pin default wording in tests.

## 4. Coercion in the default (lax) mode

| Input → field | v2 | v1 |
| --- | --- | --- |
| `1010` → `str` | **error** `string_type`; set `coerce_numbers_to_str=True` (config or `Field`) | `"1010"` |
| `5.7` → `int` | **error** `int_from_float` (`5.0` is fine) | `5` (truncated) |
| `"5"` → `int`, `"2026-11-01"` → `date`, `1` → `bool` | accepted | accepted |
| `"1"` → `int \| str` | `"1"` (smart unions keep the exact type) | `1` (first match) |
| `[("a", 1)]` → `dict` | **error** | `{"a": 1}` |

`ConfigDict(strict=True)` or `Field(strict=True)` turns off coercion (in JSON mode, ISO strings
still parse to dates and datetimes). `AwareDatetime` rejects timestamps without an offset;
`NaiveDatetime` the opposite; plain `datetime` accepts both.

## 5. Aliases

```python
class Venue(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, validate_by_name=True, validate_by_alias=True)
    venue_id: str        # accepts venueId or venue_id
    max_guests: int

Venue(venue_id="v1", max_guests=10)                     # code builds with field names
Venue.model_validate({"venueId": "v2", "maxGuests": 5})  # clients send camelCase
```

- `alias=` sets both the input key and the output key used with `by_alias=True`. With only an alias,
  **constructing by field name fails** (`Field required`) unless `validate_by_name=True`.
  `populate_by_name=True` still works but is the pre-2.11 spelling of `validate_by_name` +
  `validate_by_alias`.
- `validation_alias=` (input only, accepts `AliasChoices("venueId", "venue_id")` and `AliasPath`),
  `serialization_alias=` (output only). camelCase output for models built in code:
  `ConfigDict(alias_generator=AliasGenerator(serialization_alias=to_camel), serialize_by_alias=True)`.
- `model_dump()` and `model_dump_json()` use field names unless `by_alias=True` or the model sets
  `serialize_by_alias=True` (2.11+).
- Error `loc` uses aliases (`loc_by_alias=True` by default).

## 6. Serialization: what JSON actually comes out

`model_dump()` returns Python objects (`Decimal`, `datetime`, `timedelta`, models dumped to dicts);
`json.dumps` on it fails. `model_dump(mode="json")` returns JSON-safe values, identical to
`json.loads(model_dump_json())`.

| Value | v2 `model_dump_json()` | v1 `.json()` |
| --- | --- | --- |
| `Decimal("25.00")` | **`"25.00"`** (string) | `25.0` (`10` for whole numbers) |
| aware UTC `datetime` | `"2026-01-01T00:00:00Z"` | `"2026-01-01T00:00:00+00:00"` |
| other offsets, naive datetimes, dates | `"...+01:00"`, `"2026-01-02T03:04:05.123000"` | same |
| `timedelta(hours=2)` | **`"PT2H"`** (ISO 8601) | `7200.0` (seconds) |
| subclass instance in a `list[Base]` field | **only `Base`'s fields** | all fields |
| `{None: 1}` dict key | `{"None": 1}` | `{"null": 1}` |

Fixes, all run on 2.14.2:

```python
Price = Annotated[Decimal, PlainSerializer(float, return_type=float, when_used="json")]

class Extra(BaseModel):
    model_config = ConfigDict(polymorphic_serialization=True)  # 2.13+: dump subclasses as themselves
    label: str
    price: Price

class Quote(BaseModel):
    created: AwareDatetime
    hold_for: timedelta
    extras: list[Extra]
    internal_margin: Decimal = Field(exclude=True)      # never dumped
    note: str | None = None

    @computed_field                                      # included in every dump
    @property
    def total(self) -> Price:
        return sum((x.price for x in self.extras), Decimal("0"))

    @field_serializer("created", when_used="json")
    def utc_z(self, v: datetime) -> str:                 # normalise to UTC; the default keeps the offset
        return v.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")

    @field_serializer("hold_for", when_used="json")
    def seconds(self, v: timedelta) -> int:
        return int(v.total_seconds())

quote.model_dump_json(exclude_none=True)
# {"created":"2026-11-01T08:00:00Z","hold_for":7200,"extras":[{"label":"Projector","price":25.0},
#  {"label":"Coffee","price":0.0,"promo":"WELCOME"}],"total":25.0}
```

- `when_used="json"` keeps `Decimal`/`datetime` objects in Python-mode dumps and changes only JSON.
- Config alternatives: `ser_json_timedelta="float"` (seconds as float), `ser_json_temporal`
  (2.12+, also dates and datetimes as `seconds`/`milliseconds` since the epoch).
- Subclasses: `polymorphic_serialization=True` on the base (2.13+), `list[SerializeAsAny[Extra]]`
  on the field, or `model_dump(serialize_as_any=True)` per call. Without one of them, extra subclass
  fields vanish silently, with no warning.
- Omitting values: `exclude_none=True`, `exclude_unset=True` (keys the caller actually sent),
  `exclude_defaults=True`, per field `Field(exclude=True)` or `Field(exclude_if=lambda v: v is None)`
  (2.12+).
- `json_encoders` still works but is deprecated (`PydanticDeprecatedSince20`); use serializers.
- More recipes (v1-identical output, PATCH bodies, root models, output-only DTOs) are in
  [references/serialization.md](references/serialization.md).

## 7. Partial updates

`model_fields_set` / `exclude_unset=True` tell "sent as null" from "not sent". Since 2.14 the
`MISSING` sentinel is stable: `note: str | None | MISSING = MISSING` keeps `None` and "absent"
apart on the instance itself, and `MISSING` fields are left out of every dump.

## 8. Errors you send to clients

```python
try:
    Login.model_validate_json(body)
except ValidationError as exc:
    error_body = [
        {"field": ".".join(map(str, e["loc"])) or None, "message": e["msg"]}
        for e in exc.errors(include_input=False, include_url=False, include_context=False)
    ]
```

- `errors()` includes `input` by default: a rejected password or token is echoed back. Pass
  `include_input=False` (also on `exc.json()`). `hide_input_in_errors=True` in config only hides it
  from `str(exc)` (logs); `errors()` still returns it.
- `ctx` can hold the original exception object (`{'error': ValueError(...)}`), so
  `json.dumps(exc.errors())` raises `TypeError`. Use `include_context=False` or `exc.json()`.
- `loc` is a tuple with ints for list positions (`('lines', 1, 'amount')`); model-level errors have
  `loc == ()` (v1: `('__root__',)`); invalid JSON gives `json_invalid` and a non-object body
  `model_type`, both at `()`.
- `model_validate_json(raw)` beats `model_validate(json.loads(raw))`: one pass, and bad JSON
  becomes a `ValidationError` instead of a `JSONDecodeError`.

## 9. Upgrading Pydantic 1 code

1. Confirm the installed version and keep the lockfile change in the same commit.
2. Make deprecations fail: `filterwarnings = ["error::pydantic.warnings.PydanticDeprecationWarning"]`
   under `[tool.pytest.ini_options]`. Every shim left behind (`class Config`, `@validator`,
   `.dict()`, `min_items`, `json_encoders`) then shows up as a test error.
3. Find the rest: `rg -n "class Config|orm_mode|allow_population_by_field_name|anystr_|validate_all|@validator|@root_validator|each_item|always=True|pre=True|__root__|regex=|const=|min_items|max_items|allow_mutation|json_encoders|\.dict\(|\.json\(|parse_obj|parse_raw|parse_file|from_orm|\.copy\(|update_forward_refs|__fields__|Optional\[|: Any\b" --type py`
4. Port with the table in [references/migration-v1-to-v2.md](references/migration-v1-to-v2.md).
   The ones that **don't fail loudly**:
   - `class Config` keys renamed in v2 (`orm_mode`, `allow_population_by_field_name`,
     `anystr_strip_whitespace`, `validate_all`, `min_anystr_length`, ...) are **ignored** with only
     a `UserWarning`. Rename them in `model_config = ConfigDict(...)`.
   - `Optional[X]` and `Any` fields without a default become required. Add `= None`.
   - `@validator(always=True)` → `field_validator` plus `validate_default=True` on the field.
   - `ValueError` messages gain `Value error, `; use `PydanticCustomError` to keep them.
   - Numbers sent for `str` fields are rejected: `coerce_numbers_to_str=True` on every model that
     accepted them (v1 did it everywhere).
   - JSON: `Decimal`, UTC datetimes, `timedelta` and subclass fields come out differently
     (section 6). Pin the old output with serializers.
   - Union fields keep the input's type (`int | str` with `"1"` stays `"1"`).
5. Things that fail at import (good, but know the fix): `__root__` → `RootModel[...]` (`.root`);
   `Field(regex=)` → `pattern=` (the Rust engine has no lookaround or backreferences: use
   `ConfigDict(regex_engine="python-re")` or a validator); `Field(const=True)` → `Literal[...]`;
   `@root_validator` without `skip_on_failure=True` → `@model_validator(mode="after")`.
6. Prove nothing changed for clients: feed the same payloads through the old and new models and diff
   `errors()` (fields and custom messages) and the JSON. `from pydantic.v1 import BaseModel` runs the
   old models side by side while you compare; delete it afterwards.
7. Don't "fix" an upgrade by importing `pydantic.v1`, pinning 1.x, or silencing the warnings.

## 10. Anti-patterns

| Don't | Do |
| --- | --- |
| `x: Optional[str]` for a key clients may omit | `x: str \| None = None` |
| `@field_validator` to normalise a default | `Field(default, validate_default=True)` |
| `class Config: orm_mode = True` | `model_config = ConfigDict(from_attributes=True)`, on nested models too |
| `alias="fooBar"` when code also builds by name | `validate_by_name=True`, or `serialization_alias` only |
| `json.dumps(model.model_dump())` | `model.model_dump(mode="json")` or `model_dump_json()` |
| assume `Decimal` goes out as a number | `PlainSerializer(float, when_used="json")` or a string contract |
| `list[Base]` holding subclass instances | `polymorphic_serialization=True` / `SerializeAsAny` |
| `raise ValueError(msg)` when clients read `msg` | `PydanticCustomError(code, msg)` |
| returning `exc.errors()` as the response | `include_input=False, include_context=False`, map to your shape |
| `obj.model_copy(update=user_input)` | `Model.model_validate({**obj.model_dump(), **user_input})` |
| `@model_validator(mode="after")` + `@classmethod` | instance method returning `self` |
| `Field(pattern=r"(?!...)")` on the default engine | `regex_engine="python-re"` or a validator |

## References

- [Migration table, v1 → v2, with before/after code](references/migration-v1-to-v2.md)
- [Serialization recipes: contracts, v1-identical JSON, PATCH, root models](references/serialization.md)
- [Validators and error bodies in depth](references/validators-and-errors.md)
- [Sources and what was run](references/sources.md)
