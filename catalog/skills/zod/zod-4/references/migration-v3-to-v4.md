# Zod 3 to Zod 4: before and after

Every entry was run against `zod@4.6.7` (the Zod 3 side against the `zod/v3` export that ships in
the same package). "Silent" means the old code still runs and returns something different.

## Contents

1. [Error customisation](#1-error-customisation)
2. [ZodError](#2-zoderror)
3. [Defaults](#3-defaults)
4. [Objects and records](#4-objects-and-records)
5. [Strings and numbers](#5-strings-and-numbers)
6. [Coercion](#6-coercion)
7. [Enums, functions, refinements](#7-enums-functions-refinements)
8. [Types and internals](#8-types-and-internals)
9. [Changes inside 4.x that matter for upgrades](#9-changes-inside-4x-that-matter-for-upgrades)
10. [Search patterns](#10-search-patterns)

## 1. Error customisation

**`required_error` / `invalid_type_error`: silent.** Zod 4 ignores the keys and reports
"Invalid input: expected string, received undefined". TypeScript flags them as unknown properties,
plain JavaScript does not.

```ts
// Zod 3
z.string({ required_error: 'Name is required', invalid_type_error: 'Name must be text' }).max(80)

// Zod 4: guard by code, or the message also replaces the .max() message
z.string({
  error: (iss) =>
    iss.code === 'invalid_type' ? (iss.input === undefined ? 'Name is required' : 'Name must be text') : undefined,
}).max(80)
```

The shorter form in the official migration guide (`iss.input === undefined ? A : B` without the code
check) is only equivalent when the schema has no checks of its own.

**`errorMap`: silent.** Renamed to `error`. The function receives one argument (the issue) and
returns a string, `{ message }`, or `undefined` to fall through. There is no `ctx.defaultError`.

```ts
// Zod 3
z.number({ errorMap: (iss, ctx) => ({ message: iss.code === 'invalid_type' ? 'Expected a numeric value' : ctx.defaultError }) })
// Zod 4
z.number({ error: (iss) => (iss.code === 'invalid_type' ? 'Expected a numeric value' : undefined) })
```

**`message`** still works everywhere and is deprecated. Prefer `error` or the string shorthand
(`.min(5, 'Too short')`).

**Precedence changed.** A per-parse map (`schema.parse(x, { error })`) used to override schema-level
messages; now schema-level wins. A global map moved to `z.config({ customError })`; `z.setErrorMap`
still exists for compatibility.

**Issue shapes.** `invalid_enum_value` and `invalid_literal` merged into `invalid_value`;
`invalid_string` became `invalid_format` (with a `format` field); `invalid_date` merged into
`invalid_type`; `not_finite` is gone because infinities are an `invalid_type`. Code that switches on
`issue.code` needs a pass. `issue.received` is gone; use `issue.input` inside error maps.

## 2. ZodError

| Zod 3 | Zod 4 | Behaviour of the old call |
| --- | --- | --- |
| `err.errors` | `err.issues` | `undefined` |
| `err.formErrors` | `z.flattenError(err).formErrors` | `undefined` |
| `err.flatten()` | `z.flattenError(err)` | works, deprecated |
| `err.format()` | `z.treeifyError(err)` (different shape) or `z.formatError(err)` (deprecated) | works, deprecated |
| `err.addIssue(i)` | `err.issues.push(i)` | deprecated |

`err.message` is still a JSON string of the issues. Errors thrown by `z.function()` wrappers are
`z.core.$ZodError` and fail `instanceof z.ZodError`.

## 3. Defaults

`.default(v)` short-circuits: on `undefined` it returns `v` without running the schema, so `v` must
already be the output.

```ts
const Tags = z.string().transform((s) => s.split(','))

Tags.default('a,b').parse(undefined)   // Zod 3: ['a', 'b']   Zod 4: 'a,b' (and a TS error)
Tags.prefault('a,b').parse(undefined)  // Zod 4: ['a', 'b']
Tags.default(['a', 'b'])               // Zod 4: also fine
```

Object defaults are the most common silent break:

```ts
const Retry = z.object({ attempts: z.int().default(3) })

z.object({ retry: Retry.default({}) }).parse({})   // Zod 3: { retry: { attempts: 3 } }
                                                   // Zod 4: { retry: {} }
z.object({ retry: Retry.prefault({}) }).parse({})  // Zod 4: { retry: { attempts: 3 } }
```

Defaults inside optional fields now apply: `z.object({ a: z.string().default('x').optional() }).parse({})`
returns `{ a: 'x' }` (Zod 3 returned `{}`). Array and object default values are cloned per parse.

## 4. Objects and records

- `z.unknown()` and `z.any()` properties are no longer optional in the inferred type, and since
  4.4.0 a missing key also fails at parse time. Same for `z.undefined()` properties. Add `.optional()`.
- `.strict()` / `.passthrough()` are legacy (kept) in favour of `z.strictObject()` / `z.looseObject()`.
  `.strip()` is deprecated, `.nonstrict()` is removed.
- `.merge(B)` is deprecated; use `.extend(B.shape)` or spread both shapes. Since 4.4.0 `.merge()`
  throws if the receiver has refinements.
- Refinements now live on the object itself, so `Base.refine(...)` is still a `ZodObject`. On it,
  `.pick()`, `.omit()` and `.partial()` throw, `.extend()` throws when overwriting a key (use
  `.safeExtend()`), and `.extend()` with new keys keeps the refinement.
- `.deepPartial()` is removed; `z.deepPartial(schema)` exists from 4.5.0.
- `z.record(valueSchema)` with one argument is a type error; pass the key schema. With enum or
  literal keys, Zod 4 requires every key:

```ts
const Locale = z.enum(['en', 'de', 'fr'])
z.record(Locale, z.string()).parse({ en: 'Hi' })        // Zod 3: ok. Zod 4: issues at ['de'] and ['fr']
z.partialRecord(Locale, z.string()).parse({ en: 'Hi' }) // Zod 4: ok; unknown keys still rejected
```

## 5. Strings and numbers

- Method formats (`z.string().email()`, `.uuid()`, `.url()`, `.datetime()`, `.base64()`…) still
  work and are deprecated in favour of `z.email()`, `z.uuid()`, `z.url()`, `z.iso.datetime()`.
  `z.string().ip()` and `.cidr()` are removed: `z.union([z.ipv4(), z.ipv6()])`, `z.cidrv4()`.
- `z.uuid()` checks the RFC 9562 version and variant bits, so UUID-shaped ids from older systems
  (for example `123e4567-e89b-02d3-c456-426614174000`: version 0, variant `c`) now fail.
  `z.guid()` keeps the Zod 3 shape-only check.
- `z.base64url()` rejects padding; `z.base64()` rejects whitespace (4.4.0); `z.ipv6()` uses the
  `URL` parser and is stricter.
- Check order matters with top-level formats: `z.email().trim()` validates first and trims after.
  `z.string().trim().email()` (deprecated form) trims first. Port it as
  `z.string().trim().pipe(z.email())`, not `z.email().trim()`.
- `z.number()` rejects `Infinity`. `.int()` rejects unsafe integers. `.safe()` behaves like `.int()`.
  Prefer `z.int()`.

## 6. Coercion

- Input type of every `z.coerce.*` schema is `unknown`.
- A missing key is an error: `z.object({ muted: z.coerce.boolean() }).parse({})` returned
  `{ muted: false }` in Zod 3 and fails in Zod 4. Add `.default(false)` to keep the old result.
- Coercion semantics are unchanged and still surprising: `z.coerce.boolean().parse('false') === true`,
  `z.coerce.number().parse('') === 0`. If you are touching the line anyway, consider `z.stringbool()`
  and an empty-string-to-undefined preprocess, but treat that as a behaviour change and test it as one.

## 7. Enums, functions, refinements

- `z.nativeEnum(E)` is deprecated; `z.enum(E)` accepts TS enums and `as const` objects.
- `.Enum` and `.Values` are removed; use `.enum`. `.options` still lists the values.
- `z.function()` is no longer a schema:

```ts
// Zod 3
const vat = z.function().args(Basket).returns(z.number()).implement((basket) => vatOf(basket))
// Zod 4
const vat = z.function({ input: [Basket], output: z.number() }).implement((basket) => vatOf(basket))
const load = z.function({ input: [z.string()], output: User }).implementAsync(async (id) => fetchUser(id))
```

- `.refine(fn, (val) => ({ message }))` is removed; the message silently becomes "Invalid input".
  Use `{ error: (iss) => \`${iss.input} is not valid\` }`.
- `ctx.path` is gone from `superRefine`. Type predicates in `.refine()` were ignored in 4.0-4.2 and
  narrow the output type again since 4.3.0.
- `.superRefine()` is current (not deprecated) and accepts `{ when }` since 4.4.0.
- `z.promise()` is deprecated: await, then parse.

## 8. Types and internals

- `ZodType<Output, Def, Input>` became `ZodType<Output = unknown, Input = unknown>`. Use `z.ZodType`
  where you wrote `ZodTypeAny` (the alias still exists).
- `ZodEffects`, `ZodPreprocess` and `ZodBranded` are gone: `.transform()` returns a `ZodPipe`,
  refinements are checks inside the schema. Code that walks `schema._def` or checks
  `instanceof ZodEffects` must move to `schema._zod.def` (unstable) or, better, stop inspecting.
- `.nonempty()` now infers `T[]`; `z.tuple([T], T)` gives `[T, ...T[]]`.
- Static `.create()` factories are removed (`z.ZodString.create()`).

## 9. Changes inside 4.x that matter for upgrades

| Release | Date | Relevant changes |
| --- | --- | --- |
| 4.1.0 | 2025-08-23 | `z.codec()`, `z.decode()`, `z.encode()` (bidirectional transforms) |
| 4.2.0 | 2025-12-15 | `z.xor()`, `z.looseRecord()`, `z.fromJSONSchema()` (experimental), Standard JSON Schema |
| 4.3.0 | 2025-12-31 | `.exactOptional()`, `.apply()`, type predicates in `.refine()` narrow again; `.pick()`/`.omit()` throw on refined objects and on unknown keys; `.extend()` may not overwrite keys of a refined object |
| 4.4.0 | 2026-04-29 | soundness fixes that reject more input: required `z.unknown()`/`z.any()`/`z.undefined()` keys, `.merge()` throws on refined receivers, stricter `z.base64()`/`z.httpUrl()`/`z.cuid()`, tuple defaults, `when` on `.superRefine()` |
| 4.5.0 | 2026-08-28 | `z.compile()`, `z.deepPartial()`, `.exactPartial()`, `z.validate()`, `z.creditCard()`, locales |
| 4.6.0 | 2026-09-09 | `.validate()` method, `z.iban()`, `z.withParser()`, standalone `@zod/mini` |

If a repo is pinned to an early 4.x, an upgrade within 4.x can still break tests through the 4.4.0
fixes. Read that release's notes before bumping.

## 10. Search patterns

```sh
# Removed or silently ignored
rg -n "required_error|invalid_type_error|errorMap|\.errors\b|formErrors|\.Enum\.|\.Values\." src
rg -n "\.ip\(|\.cidr\(|z\.function\(\)\s*\.args|ctx\.path|nativeEnum|\.deepPartial\(" src
# Behaviour changes types won't flag
rg -n "\.default\(\{|\.transform\([^)]*\)[^;]*\.default\(|z\.record\(z\.(enum|literal)" src
rg -n "z\.(unknown|any|undefined)\(\)(?!\.optional)" --pcre2 src
rg -n "\.uuid\(|z\.coerce\.|instanceof (z\.)?ZodError|\.refine\([^,]+,\s*\(" src
```
