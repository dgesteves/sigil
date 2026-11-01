# Sources

Checked on 2026-11-01 against `zod@4.6.7` (npm `latest`, published 2026-10-12). Every behaviour
described in this skill was also run against the installed package; the Zod 3 comparisons used the
`zod/v3` export bundled in the same package (the 3.25 API).

## Official documentation (zod.dev, source in colinhacks/zod `packages/docs/content`)

- Migration guide: https://zod.dev/v4/changelog
- Schema API (formats, objects, records, refinements, defaults, prefaults, codecs, functions): https://zod.dev/api
- Customizing errors (error param, precedence, locales, `reportInput`): https://zod.dev/error-customization
- Formatting errors (`z.treeifyError`, `z.prettifyError`, `z.flattenError`): https://zod.dev/error-formatting
- Basics (`safeParse`, `.validate()`, `z.input`/`z.output`): https://zod.dev/basics
- JSON Schema (`z.toJSONSchema`, `io`, `target`, `unrepresentable`, `z.fromJSONSchema`): https://zod.dev/json-schema
- Codecs: https://zod.dev/codecs
- Library authors (`zod/v4/core`, `zod/v3` permalinks, peer dependencies): https://zod.dev/library-authors

## Release notes (github.com/colinhacks/zod/releases)

- v4.1.0 (2025-08-23): codecs
- v4.2.0 (2025-12-15): `z.xor`, `z.looseRecord`, `z.fromJSONSchema`
- v4.3.0 (2025-12-31): `.exactOptional()`, type predicates in `.refine()` narrow, `.pick()`/`.omit()`/`.extend()` restrictions on refined objects
- v4.4.0 (2026-04-29): soundness fixes (required `z.unknown()`/`z.any()`/`z.undefined()` keys, `.merge()` on refined receivers, stricter string validators), `when` on `.superRefine()`
- v4.5.0 (2026-08-28): `z.compile`, `z.deepPartial`, `.exactPartial()`, `z.validate`
- v4.6.0 (2026-09-09): `.validate()` method, `z.iban`, `@zod/mini`

## Where the docs and the package disagree

- The migration guide says type predicates in `.refine()` are ignored. That was true for 4.0-4.2;
  since 4.3.0 they narrow the output type (verified with TypeScript 6.0.3 on 4.6.7).
- The guide lists single-argument `z.record(schema)` as removed. On 4.6.7 it is a type error but
  still validates values at runtime; treat it as removed.
- The guide's replacement for `required_error`/`invalid_type_error` (`iss.input === undefined ? A : B`)
  also replaces messages of the schema's own checks, per the documented error precedence. Guard by
  `iss.code === 'invalid_type'`.
