# Sources

Checked on 2026-11-01 against `pydantic==2.14.2` with `pydantic-core==2.50.2` (PyPI `latest`,
published 2026-10-29) on CPython 3.14. The Pydantic 1 comparisons were run against
`pydantic==1.10.26` on CPython 3.13, and against the `pydantic.v1` copy bundled in 2.14.2
(reports `1.10.27`, runs on 3.14).

## Official documentation (pydantic.dev/docs/validation, formerly docs.pydantic.dev)

- Migration guide, v1 to v2: https://pydantic.dev/docs/validation/latest/migration/
  (source: `docs/migration.md` in github.com/pydantic/pydantic)
- Models (`RootModel`, `model_copy`, `model_construct`, attribute copies): https://pydantic.dev/docs/validation/2.14/concepts/models/
- Fields (`validate_default`, `default_factory` with data, `exclude`, `exclude_if`): https://pydantic.dev/docs/validation/2.14/concepts/fields/
- Validators (modes, ordering, `ValidationInfo`, model validators): https://pydantic.dev/docs/validation/2.14/concepts/validators/
- Serialization (`model_dump` modes, serializers, `SerializeAsAny`, `polymorphic_serialization`, `computed_field`): https://pydantic.dev/docs/validation/2.14/concepts/serialization/
- Aliases (`validate_by_name`, `validate_by_alias`, `serialize_by_alias`, `AliasGenerator`): https://pydantic.dev/docs/validation/2.14/concepts/alias/
- Conversion table (lax and strict coercion): https://pydantic.dev/docs/validation/2.14/concepts/conversion_table/
- Unions (smart mode): https://pydantic.dev/docs/validation/2.14/concepts/unions/
- Strict mode: https://pydantic.dev/docs/validation/2.14/concepts/strict_mode/
- Types (`MISSING`, `AwareDatetime`): https://pydantic.dev/docs/validation/2.14/concepts/types/
- `ConfigDict` reference (`ser_json_timedelta`, `ser_json_temporal`, `regex_engine`, `coerce_numbers_to_str`, `hide_input_in_errors`): https://pydantic.dev/docs/validation/2.14/api/config/
- Error types: https://pydantic.dev/docs/validation/2.14/errors/errors/

## Release notes (HISTORY.md, github.com/pydantic/pydantic)

- v2.11: `validate_by_name` / `validate_by_alias` / `serialize_by_alias`; `populate_by_name` discouraged; instance access to `model_fields` deprecated.
- v2.12.0 (2025-10-07): initial Python 3.14 support; `ser_json_temporal` and `val_temporal_unit`; `exclude_if`; experimental `MISSING`; "after" model validators no longer implicitly converted to class methods (classmethod form deprecated).
- v2.13.0 (2026-04-13): `polymorphic_serialization`; `pydantic.v1` updated to 1.10.26 with Python 3.14 support.
- v2.14.0 (2026-10-08): drops Python 3.9, adds 3.15; `MISSING` stabilised (`from pydantic import MISSING`); `model_copy()` deep-copies only non-updated fields.
- v2.14.2 (2026-10-29): current release at the time of writing.
- PyPI: https://pypi.org/project/pydantic/2.14.2/ and https://github.com/pydantic/pydantic/blob/main/HISTORY.md

## Behaviour reproduced by running it

On 2.14.2 unless stated:

- `Optional[int]` and `Any` fields without a default raise `missing`; on 1.10.26 both default to `None`.
- `class Config` emits `PydanticDeprecatedSince20`. Renamed keys inside it (`orm_mode`,
  `allow_population_by_field_name`, `anystr_strip_whitespace`, `validate_all`, `allow_mutation`,
  `smart_union`) stay in `model_config` unapplied, with only a `UserWarning`; `from_orm` then raises
  `PydanticUserError`, construction by field name fails, whitespace is kept, the model is mutable.
- `ValueError("x")` in a validator gives `msg == "Value error, x"` (1.10.26: `"x"`); `assert` gives
  `"Assertion failed, ..."`; `PydanticCustomError` keeps the text; `TypeError` propagates.
- `json.dumps(exc.errors())` raises `TypeError` when `ctx` holds a `ValueError`; `errors()` returns
  `input` even with `hide_input_in_errors=True`, which only affects `str(exc)`.
- `model_dump_json()`: `Decimal("12.50")` → `"12.50"`, UTC datetime → `...Z`, `timedelta(minutes=90)`
  → `"PT1H30M"`; 1.10.26 `.json()`: `12.5`, `10` for `Decimal("10")`, `+00:00`, `5400.0`.
- A `Circle` inside `list[Shape]` dumps only `Shape` fields, with no warning even under
  `warnings.simplefilter("error")`; `polymorphic_serialization=True`, `SerializeAsAny` and
  `serialize_as_any=True` each restore the subclass fields.
- `int` for a `str` field: `string_type` error (1.10.26 coerces); `coerce_numbers_to_str=True` on
  the config or on `Field` restores it. `5.5` for `int`: `int_from_float` (1.10.26 truncates).
  `"1"` for `int | str` stays `"1"` (1.10.26: `1`). Pairs for `dict`: error (1.10.26 coerces).
- `Field(pattern=r"^(?!TST)...")` raises `SchemaError` at class creation;
  `regex_engine="python-re"` accepts it. `Field(regex=)`, `const=`, `unique_items=` and a field named
  `__root__` raise `PydanticUserError`; `min_items`, `allow_mutation`, extra `Field` kwargs,
  `GenericModel`, `parse_obj_as`, `validate_arguments`, `.dict()`, `.json()`, `.copy()`,
  `__fields__` and `json_encoders` emit `PydanticDeprecatedSince20`.
- `@root_validator` without `skip_on_failure=True` raises `PydanticUserError`; `@model_validator(mode="after")`
  on a classmethod emits `PydanticDeprecatedSince212`; returning a non-`self` value warns.
- `from_attributes=True` on a parent model does not apply to nested models; passing
  `from_attributes=True` to `model_validate` does.
- Field validator order: decorator `before`, `Annotated` befores right to left, type validation,
  `Annotated` afters left to right, decorator `after`.
- Every code block in SKILL.md and in serialization.md, migration-v1-to-v2.md and this folder was
  run; the outputs shown are the actual outputs.
