# Validators and error bodies

Checked on pydantic 2.14.2.

## Where to put a rule

| Rule | Use |
| --- | --- |
| Shape and bounds of one value | the type plus `Field(...)` constraints: `min_length`, `max_length`, `pattern`, `ge`, `gt`, `le`, `lt`, `multiple_of`, `max_digits`, `decimal_places` |
| Normalising one value | `field_validator(mode="after")` or `Annotated[str, AfterValidator(f)]` |
| Accepting another input shape | `field_validator(mode="before")` or `BeforeValidator` (input is raw, any type) |
| A rule per list item | `list[Annotated[T, AfterValidator(f)]]` or constraints inside `Annotated` |
| A rule across fields | `model_validator(mode="after")` (instance method, return `self`) |
| A cross-field error shown next to field errors | `field_validator` on the later field reading `info.data` |
| A rule that needs request state (allowed codes, the current user) | `info.context`, passed with `Model.model_validate(data, context={...})` |
| Re-checking on attribute assignment | `ConfigDict(validate_assignment=True)` |

## Order

For one field, measured:

1. `@field_validator(mode="before")` decorators,
2. `BeforeValidator`s in `Annotated`, right to left,
3. type validation and `Field` constraints,
4. `AfterValidator`s in `Annotated`, left to right,
5. `@field_validator(mode="after")` decorators.

Fields are validated in definition order; `info.data` holds the fields before this one that
passed. A field that failed is simply absent, so write `if "password" in info.data and ...`.

Model validators: `before` runs on the raw input first, then fields, then `after` (only if every
field passed). A `before` model validator that raises stops everything: no field errors are
reported in that case.

```python
class Signup(BaseModel):
    email: str = Field(pattern=r"@")
    password: str = Field(min_length=8)
    confirm: str

    @field_validator("confirm")
    @classmethod
    def same_password(cls, v: str, info: ValidationInfo) -> str:
        if "password" in info.data and v != info.data["password"]:
            raise PydanticCustomError("password_mismatch", "Passwords do not match")
        return v

# Signup(email="x", password="longenough", confirm="other") reports both:
# [(('email',), "String should match pattern '@'"), (('confirm',), 'Passwords do not match')]
```

## Defaults

Defaults skip validation, including field validators. `Field(default, validate_default=True)` (or
`ConfigDict(validate_default=True)` for every field) runs the full pipeline on the default.
`default_factory` may take the validated data: `Field(default_factory=lambda data: data["start"])`.

## Raising errors

| Raise | Result |
| --- | --- |
| `ValueError("text")` | `type="value_error"`, `msg="Value error, text"`, `ctx={"error": ValueError(...)}` |
| `assert cond, "text"` | `type="assertion_error"`, `msg="Assertion failed, text"`; skipped entirely under `python -O` |
| `PydanticCustomError("code", "{n} is too many", {"n": 5})` | `type="code"`, `msg="5 is too many"`, `ctx={"n": 5}` |
| `TypeError`, `KeyError`, anything else | not caught: propagates out of validation |

`PydanticCustomError` is in `pydantic_core`. Use it whenever the message is product copy or an API
contract. `PydanticKnownError("greater_than", {"gt": 0})` reuses a built-in error type.

## The error list

```python
exc.errors()
# [{'type': 'string_too_short', 'loc': ('password',), 'msg': 'String should have at least 12 characters',
#   'input': 'hunter2', 'ctx': {'min_length': 12}, 'url': 'https://errors.pydantic.dev/2.14/v/string_too_short'}]
```

- `input` echoes what the client sent, passwords included. `exc.errors(include_input=False)`,
  `exc.json(include_input=False)`. `hide_input_in_errors=True` hides it only in `str(exc)`.
- `ctx` may contain exception objects; `json.dumps(exc.errors())` then raises `TypeError`.
  `include_context=False`, or `exc.json()` which stringifies them.
- `include_url=False` drops the docs link.
- `loc`: field names or aliases (aliases by default, `loc_by_alias`), ints for list indexes, dict
  keys for dict entries; `()` for model-level errors, invalid JSON (`json_invalid`) and a body of the
  wrong type (`model_type`). Join with `".".join(map(str, loc))`.
- `type` codes are stable identifiers (`missing`, `string_type`, `int_parsing`, `too_short`,
  `extra_forbidden`, `literal_error`, `enum`, ...); default `msg` wording is not a contract and
  changes between minor versions.
- `exc.error_count()`, `exc.title` (model name).

A 422 body that is safe to return:

```python
def error_body(exc: ValidationError) -> list[dict[str, str | None]]:
    return [
        {"field": ".".join(map(str, e["loc"])) or None, "code": e["type"], "message": e["msg"]}
        for e in exc.errors(include_input=False, include_url=False, include_context=False)
    ]
```

## Strictness

- `ConfigDict(strict=True)`, `Field(strict=True)` or `StrictInt`/`StrictStr` disable coercion. In
  JSON mode strings still parse into `date`, `datetime`, `UUID` and `Decimal` because JSON has no
  native type for them.
- `ConfigDict(extra="forbid")` rejects unknown keys (`extra_forbidden`). Don't use it for
  third-party webhooks: providers add fields without notice. The default `"ignore"` drops them;
  `"allow"` keeps them in `model_extra`.
- `Literal[...]` for closed string sets gives `literal_error` with the allowed values in `ctx`;
  `Enum` gives `enum`.
