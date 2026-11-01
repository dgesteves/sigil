# Serialization recipes

All output below was produced by pydantic 2.14.2. The three dump calls:

| Call | Returns | Use for |
| --- | --- | --- |
| `m.model_dump()` | dict of Python objects (`Decimal`, `datetime`, `UUID`, `timedelta`, enums as members unless `use_enum_values`) | passing data to Python code, ORMs |
| `m.model_dump(mode="json")` | dict of JSON-safe values | anything that will be `json.dumps`-ed: caches, queues, document stores |
| `m.model_dump_json()` | compact JSON `str` | response bodies |

`json.loads(m.model_dump_json()) == m.model_dump(mode="json")` for the same arguments. All three
take `by_alias`, `include`, `exclude`, `exclude_unset`, `exclude_defaults`, `exclude_none`,
`serialize_as_any`, `round_trip`.

## Default JSON per type (2.14.2)

| Type | JSON | Note |
| --- | --- | --- |
| `Decimal("0.10")` | `"0.10"` | a string, digits preserved |
| `datetime` aware UTC | `"2026-03-01T12:00:00Z"` | other offsets are kept: `"+01:00"` |
| `datetime` naive | `"2026-03-01T00:00:00"` | microseconds appear when set: `.123000` |
| `date`, `time` | `"2026-03-01"`, `"12:00:00"` | |
| `timedelta(minutes=5)` | `"PT5M"` | ISO 8601 duration |
| `bytes` | UTF-8 text | `ser_json_bytes="base64"` for binary |
| `float("nan")` | `null` | `ser_json_inf_nan="constants"` or `"strings"` to change |
| `set` / `frozenset` | array | |
| `Enum` | its value | |
| `{None: 1}` | `{"None": 1}` | keys are `str(key)` |

## Output identical to Pydantic 1's `.json()`

Pydantic 1 wrote `Decimal` as a number (`int` when the exponent is non-negative, else `float`),
datetimes with `isoformat()` (`+00:00`, never `Z`), and `timedelta` as total seconds (a float).
Reusable annotated types keep that contract without touching every model:

```python
def v1_decimal(value: Decimal) -> int | float:
    return int(value) if value.as_tuple().exponent >= 0 else float(value)

V1Decimal = Annotated[Decimal, PlainSerializer(v1_decimal, when_used="json")]
V1DateTime = Annotated[datetime, PlainSerializer(lambda v: v.isoformat(), return_type=str, when_used="json")]
V1Duration = Annotated[timedelta, PlainSerializer(lambda v: v.total_seconds(), return_type=float, when_used="json")]

class Reading(BaseModel):
    value: V1Decimal
    taken_at: V1DateTime
    window: V1Duration

Reading(value=Decimal("10"), taken_at=datetime(2026, 3, 1, 12, tzinfo=timezone.utc),
        window=timedelta(minutes=5)).model_dump_json()
# {"value":10,"taken_at":"2026-03-01T12:00:00+00:00","window":300.0}
```

- Put the serializer on **every** field of that type, nested models included. A serializer on the
  top-level total and not on line amounts is the usual partial port.
- `when_used="json"` keeps Python-mode dumps returning `Decimal`/`datetime` for internal callers.
- Config-level alternatives exist for durations only: `ser_json_timedelta="float"`, or
  `ser_json_temporal="seconds"` (2.12+), which also turns dates and datetimes into epoch numbers.
  There is no config switch for Decimal-as-number.

Money as a JSON number goes through `float`, so very large or very precise amounts lose digits
(`float(Decimal("0.1") + Decimal("0.2"))` is `0.30000000000000004` → prints `0.3`, but 17+
significant digits don't survive). If you own the contract, the default string form is the safer
choice; if clients already parse numbers, keep numbers.

## camelCase on the way out, field names on the way in

```python
class SensorOut(BaseModel):
    model_config = ConfigDict(
        from_attributes=True,
        alias_generator=AliasGenerator(serialization_alias=to_camel),
        serialize_by_alias=True,               # 2.11+: no by_alias=True needed at call sites
    )
    sensor_id: str
# SensorOut(sensor_id="s1").model_dump_json() == '{"sensorId":"s1"}'
```

`alias_generator=to_camel` alone sets the *validation* alias too, so `SensorOut(sensor_id=...)`
fails with `Field required` unless you also set `validate_by_name=True`. Computed fields get the
generated serialization alias as well (`double_width` → `doubleWidth`). An explicit
`Field(serialization_alias="dueInDays")` overrides the generator for one field.

## Output models (DTOs) instead of exclusions

When a model holds secrets or internal fields, a separate output model is harder to get wrong than
remembering `exclude=` at every call site:

```python
class SensorIn(BaseModel):
    sensor_id: str
    secret_key: str

SensorOut.model_validate(sensor_in)           # from_attributes reads the attributes it declares
SensorOut.model_validate(sensor_in.model_dump())   # or go through a dict
```

Inside one model: `Field(exclude=True)` (never dumped), `Field(exclude_if=lambda v: v is None)`
(2.12+), or per call `model_dump(exclude={"password_hash"})` / `include={"id"}`.

## Subclass instances in a field typed as the base class

```python
class Shape(BaseModel):
    name: str

class Circle(Shape):
    radius: float

class Drawing(BaseModel):
    shapes: list[Shape]

Drawing(shapes=[Circle(name="c", radius=1.0)]).model_dump_json()
# {"shapes":[{"name":"c"}]}             <- radius is gone, no warning
```

Pydantic 2 serializes a value by the field's declared type. Pick one:

- `model_config = ConfigDict(polymorphic_serialization=True)` on the base class (2.13+): every
  field typed as `Shape` dumps the runtime class.
- `shapes: list[SerializeAsAny[Shape]]` on the field.
- `model_dump_json(serialize_as_any=True)` per call (applies to every field in that dump).

Validation is unaffected: a `Circle` passed in stays a `Circle`; a dict passed in becomes a `Shape`.
For tagged payloads, model the union explicitly: `Annotated[Circle | Square, Field(discriminator="shape")]`.

## Computed values

```python
class Box(BaseModel):
    inner_width: int

    @computed_field
    @property
    def double_width(self) -> int:
        return self.inner_width * 2
```

`@computed_field` properties are included in every dump and in the serialization JSON schema; a
plain `@property` never is. The return annotation drives serialization, so `-> V1Decimal` or an
annotated money type applies its serializer. Overriding the property in a subclass works (and needs
polymorphic serialization if the instance sits in a base-typed field).

## Partial updates (PATCH)

```python
class SensorPatch(BaseModel):
    label: str | None = None
    threshold: float | None = None

patch = SensorPatch.model_validate_json('{"label": null}')
patch.model_fields_set                 # {'label'}
patch.model_dump(exclude_unset=True)   # {'label': None}  -> "clear the label", threshold untouched
```

2.14 stabilised the `MISSING` sentinel, which puts "not sent" on the instance itself:

```python
from pydantic import MISSING

class SensorPatch(BaseModel):
    label: str | None | MISSING = MISSING
    threshold: float | MISSING = MISSING

p = SensorPatch.model_validate_json('{"label": null}')
p.threshold is MISSING     # True
p.model_dump()             # {'label': None}   (MISSING fields are never dumped)
```

## Root models

```python
class Readings(RootModel[list[Reading]]):
    def __iter__(self):
        return iter(self.root)

Readings.model_validate_json(body).root
Readings(items).model_dump_json()        # a JSON array, not {"root": [...]}
```

For one-off parsing of a non-model type, `TypeAdapter(list[Reading]).validate_json(body)` and
`.dump_json(value)` avoid defining a class.

## Wrapping the whole output

```python
class Envelope(BaseModel):
    data: dict[str, Any]

    @model_serializer(mode="wrap")
    def add_version(self, handler):
        out = handler(self)
        out["version"] = 2
        return out
# {"data":{"a":1},"version":2}
```

Prefer field serializers; a model serializer is for reshaping the whole document.
