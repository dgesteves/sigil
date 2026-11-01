# Pydantic 1 → 2: the full mapping

Checked on pydantic 2.14.2 (Python 3.14) against pydantic 1.10.26 (Python 3.13). "Loud" means the
v1 spelling raises at import or call time on 2.14.2; "shim" means it still works but emits a
`PydanticDeprecatedSince20` (or later) warning; "silent" means it runs and behaves differently.

## Model methods

| v1 | v2 | On 2.14.2 |
| --- | --- | --- |
| `Model.parse_obj(data)` | `Model.model_validate(data)` | shim |
| `Model.parse_raw(text)` | `Model.model_validate_json(text)` | shim |
| `Model.parse_file(path)` | read the file, then `model_validate_json` | shim |
| `Model.from_orm(row)` | `Model.model_validate(row)` with `from_attributes=True` | loud without the config key |
| `obj.dict(...)` | `obj.model_dump(...)` | shim |
| `obj.json(...)` | `obj.model_dump_json(...)` (no `indent`/`ensure_ascii` passthrough to `json.dumps`) | shim, **different output** (see serialization.md) |
| `obj.copy(update=...)` | `obj.model_copy(update=...)` (still no validation) | shim |
| `Model.construct(...)` | `Model.model_construct(...)` | shim |
| `Model.schema()`, `schema_json()` | `Model.model_json_schema()` | shim |
| `Model.update_forward_refs()` | `Model.model_rebuild()` | shim |
| `Model.__fields__` | `Model.model_fields` (on the class; on an instance it warns since 2.11) | shim |
| `parse_obj_as(T, data)` | `TypeAdapter(T).validate_python(data)` | shim |
| `obj == {"a": 1}` | compare `obj.model_dump()`; models never equal dicts now | silent (`False`) |

## Config

`class Config:` still works but is deprecated. Inside it, keys renamed in v2 are kept in
`model_config` and **ignored**, with only a `UserWarning` ("Valid config keys have changed in V2").
Moving them into `ConfigDict(...)` under the old name has the same effect: nothing.

| v1 key | v2 key |
| --- | --- |
| `orm_mode` | `from_attributes` |
| `allow_population_by_field_name` | `validate_by_name=True` (+ `validate_by_alias=True`, the default); `populate_by_name` is the 2.0-2.10 spelling |
| `anystr_strip_whitespace`, `anystr_lower`, `anystr_upper` | `str_strip_whitespace`, `str_to_lower`, `str_to_upper` |
| `min_anystr_length`, `max_anystr_length` | `str_min_length`, `str_max_length` |
| `validate_all` | `validate_default` |
| `schema_extra` | `json_schema_extra` |
| `keep_untouched` | `ignored_types` |
| `allow_mutation = False` | `frozen=True` (the old key is dropped, so the model silently becomes mutable) |
| `json_encoders` | still accepted, deprecated: use `field_serializer` / `PlainSerializer` |
| `smart_union` | removed: smart is the default `union_mode` |
| `fields = {...}`, `getter_dict`, `copy_on_model_validation`, `json_loads`, `json_dumps`, `error_msg_templates`, `underscore_attrs_are_private` | removed |

`from_attributes` on a parent model does not cover nested models: each nested model needs its own
`from_attributes=True`, or pass it per call (`Model.model_validate(row, from_attributes=True)`,
which does propagate).

## Fields

| v1 | v2 | On 2.14.2 |
| --- | --- | --- |
| `x: Optional[int]` (no default) | `x: int \| None = None` | silent: **required** in v2 |
| `x: Any` (no default) | `x: Any = None` | silent: **required** in v2 |
| `Field(..., regex=r"...")` | `Field(pattern=r"...")` | loud (`PydanticUserError`) |
| `Field(const=True)` | `Literal[value]` with that default | loud |
| `Field(min_items=, max_items=)` | `Field(min_length=, max_length=)` | shim |
| `Field(allow_mutation=False)` | `Field(frozen=True)` | shim |
| `Field(unique_items=True)` | `set[...]` or a validator | loud |
| `Field(..., foo="bar")` extra kwargs for the schema | `Field(json_schema_extra={"foo": "bar"})` | shim |
| `__root__: list[int]` | `class M(RootModel[list[int]])`, value at `.root`; `M([1, 2])` | loud |
| `class G(GenericModel, Generic[T])` | `class G(BaseModel, Generic[T])` | shim (`pydantic.generics.GenericModel` is a deprecated alias) |
| `constr(...)`, `conint(...)` | still available; `Annotated[str, Field(min_length=1)]` is preferred | works |
| `ConstrainedStr`, `ConstrainedInt`, ... | `Annotated[...]` types | loud (`PydanticImportError`) |

**Patterns** run on the Rust `regex` crate by default: linear time, but no lookarounds or
backreferences. A v1 pattern like `^(?!TEST)[A-Z]{3}-\d{6}$` raises `SchemaError` when the class is
created. Keep the rule with `ConfigDict(regex_engine="python-re")` or move it into a
`field_validator` using `re.fullmatch`.

## Validators

| v1 | v2 |
| --- | --- |
| `@validator("x")` | `@field_validator("x")` + `@classmethod` |
| `@validator("x", pre=True)` | `@field_validator("x", mode="before")` |
| `@validator("x", always=True)` | `@field_validator("x")` **and** `x: T = Field(default, validate_default=True)` |
| `@validator("xs", each_item=True)` | `xs: list[Annotated[T, AfterValidator(f)]]`, or a validator over the list |
| `def v(cls, value, values, field, config)` | `def v(cls, value, info: ValidationInfo)`: `info.data`, `info.field_name`, `info.config` |
| `@validator(..., allow_reuse=True)` | drop it |
| `@root_validator(pre=True)` | `@model_validator(mode="before")` + `@classmethod`; input can be any type |
| `@root_validator(skip_on_failure=True)` | `@model_validator(mode="after")` as an instance method returning `self` |
| `@root_validator` (no args) | raises `PydanticUserError` on 2.x: decide between the two above |
| `@validate_arguments` | `@validate_call` |

Behaviour that changes even when the decorator is ported correctly:

- `ValueError("msg")` produces `msg == "Value error, msg"`; v1 produced `"msg"`. Use
  `PydanticCustomError("code", "msg")` when the text reaches users.
- A `TypeError` inside a validator propagates instead of becoming a validation error.
- A model "after" validator's error has `loc == ()`; v1's root validator used `('__root__',)`.
- Without `validate_default=True`, a validator never sees the default: v1 `always=True` code that
  normalised defaults (`"eur"` → `"EUR"`) silently stops doing it.

```python
# v1
class Rental(BaseModel):
    picked_up: date
    returned: date
    currency: str = "eur"
    tags: List[str] = []

    @validator("currency", always=True)
    def up(cls, v):
        return v.upper()

    @validator("tags", pre=True)
    def split(cls, v):
        return v.split(",") if isinstance(v, str) else v

    @root_validator(skip_on_failure=True)
    def check(cls, values):
        if values["returned"] < values["picked_up"]:
            raise ValueError("returned before pick-up")
        return values

# v2
class Rental(BaseModel):
    picked_up: date
    returned: date
    currency: str = Field("eur", validate_default=True)
    tags: list[str] = []

    @field_validator("currency")
    @classmethod
    def up(cls, v: str) -> str:
        return v.upper()

    @field_validator("tags", mode="before")
    @classmethod
    def split(cls, v: Any) -> Any:
        return v.split(",") if isinstance(v, str) else v

    @model_validator(mode="after")
    def check(self) -> "Rental":
        if self.returned < self.picked_up:
            raise PydanticCustomError("return_order", "returned before pick-up")
        return self
```

## Types and coercion

| Input | v2 lax mode | v1 |
| --- | --- | --- |
| int/float/Decimal for a `str` field | error (`coerce_numbers_to_str=True` restores it) | coerced |
| float with a fraction for an `int` field | error `int_from_float` | truncated |
| `"1"` for `int \| str` | stays `"1"` | `1` |
| list of pairs for a `dict` field | error | coerced |
| tuple for a dataclass field | error (use a dict) | accepted |
| subclass instance for a model field | accepted, kept as is; dumped as the declared type | dumped with all fields |
| `Url`, `AnyHttpUrl` | not `str` subclasses: `str(url)` | `str` subclasses |

## Moved packages and names

- `BaseSettings` → `pydantic_settings.BaseSettings` (separate `pydantic-settings` package).
- `Color`, `PaymentCardNumber` → `pydantic-extra-types`.
- `pydantic.error_wrappers.ValidationError` → `pydantic.ValidationError`.
- `pydantic.utils.to_camel` → `pydantic.alias_generators.to_pascal`; `to_lower_camel` →
  `pydantic.alias_generators.to_camel`.

## Grep before you call it done

```sh
rg -n "class Config|orm_mode|allow_population_by_field_name|anystr_|validate_all|json_encoders" --type py
rg -n "@validator|@root_validator|each_item|always=True|pre=True|allow_reuse" --type py
rg -n "__root__|regex=|const=|min_items|max_items|allow_mutation|GenericModel|parse_obj_as" --type py
rg -n "\.dict\(|\.json\(|parse_obj|parse_raw|parse_file|from_orm|\.copy\(|__fields__|update_forward_refs" --type py
rg -n "Optional\[[^]]+\]\s*($|#)|:\s*Any\s*($|#)" --type py   # fields that lost their implicit None
rg -n "pydantic\.v1" --type py                                  # must be empty when the port is done
```

The `.json(` and `.copy(` patterns also match unrelated objects; read each hit.
