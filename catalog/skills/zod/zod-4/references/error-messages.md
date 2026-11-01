# Error customisation and formatting (Zod 4)

Checked against `zod@4.6.7`.

## The `error` parameter

Every schema factory and check takes a message as a string, or `{ error }`:

```ts
z.string('Must be text')
z.string().min(5, 'Too short')
z.email({ error: 'That address looks wrong' })
z.array(z.string(), 'Must be a list')
z.enum(['draft', 'live'], 'Unknown stage')
```

`error` can be a function (an "error map"). It runs when an issue is raised and receives the issue:

| Field | Meaning |
| --- | --- |
| `iss.code` | `invalid_type`, `too_small`, `too_big`, `invalid_format`, `invalid_value`, `not_multiple_of`, `unrecognized_keys`, `invalid_union`, `invalid_key`, `invalid_element`, `custom` |
| `iss.input` | the value that failed (undefined for a missing key) |
| `iss.path` | path inside the parsed value |
| `iss.inst` | the schema or check that raised the issue |
| `iss.schema` | the schema that owns the issue (read metadata from it) |
| per code | `minimum`, `maximum`, `inclusive`, `expected`, `format`, `keys`… |

Return a string, `{ message }`, or `undefined` to fall through to the next level. There is no
`ctx.defaultError`; returning `undefined` is how you keep the default.

## Precedence

1. Check-level: `.min(5, 'msg')`
2. Schema-level: `z.string('msg')`, `z.string({ error })`. **Also applies to that schema's own checks
   when they have no message.** `z.string('Bad').min(5).safeParse('ab')` gives "Bad".
3. Per-parse: `schema.safeParse(x, { error })`
4. Global: `z.config({ customError })`
5. Locale: `z.config(z.locales.de())` (the `en` locale is loaded by default in classic Zod; Zod Mini
   loads none and says "Invalid input")

Zod 3 put the per-parse map above the schema. When porting code that passed `errorMap` to `.parse()`,
re-check every schema that has its own messages.

### Required vs wrong type, without clobbering checks

```ts
const required = (name: string) => (iss: { code?: string; input?: unknown }) => {
  if (iss.code !== 'invalid_type') return undefined
  return iss.input === undefined ? `${name} is required` : `${name} has the wrong type`
}

const Title = z.string({ error: required('Title') }).min(1).max(120)
```

### Empty form inputs count as missing

HTML forms send `''` for empty inputs. Map it to `undefined` before the schema so the "required"
branch fires and optional fields stay absent:

```ts
const emptyAsMissing = (v: unknown) => (v === '' ? undefined : v)
const mustHave = (message: string) =>
  z.preprocess(emptyAsMissing, z.string({ error: (iss) => (iss.input === undefined ? message : undefined) }))
const mayHave = z.preprocess(emptyAsMissing, z.string().optional())

const Ticket = z.object({ subject: mustHave('Add a subject'), ccList: mayHave })
```

With `z.preprocess`, a missing key and an empty value behave the same, and an optional inner schema
keeps the key optional in the object.

### Metadata-driven messages

`iss.schema` points at the owning schema, so a global map can read registry metadata:

```ts
z.config({
  customError: (iss) => {
    const meta = iss.schema && z.globalRegistry.get(iss.schema)
    return meta?.title ? `${meta.title} is invalid` : undefined
  },
})
z.string().min(32).meta({ title: 'API key' })
```

### Internationalisation

```ts
z.config(z.locales.de())          // all built-in messages in German
```

Translating your own copy: either call your `t()` inside `error` (runs at parse time, so it picks up
the current language on every parse), or render from `issue.code` plus the issue's fields at display
time.

## Formatting a ZodError

Use `error.issues` (Zod 3's `error.errors` is gone). Each issue has `code`, `path`, `message`, and
code-specific fields; `input` only with `{ reportInput: true }`.

### Dot-path field map (forms and JSON APIs)

```ts
export function issuesByPath(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const issue of error.issues) {
    const key = issue.path.map(String).join('.') // '' for root-level issues
    ;(out[key] ??= []).push(issue.message)
  }
  return out
}
```

Root-level issues (non-object body, `unrecognized_keys` on a strict object) land under `''`; map
that to a form-level error if your UI has one.

### Built-in formatters

| Function | Shape | Use for |
| --- | --- | --- |
| `z.flattenError(err)` | `{ formErrors: string[], fieldErrors: { [topKey]: string[] } }` | flat schemas only: nested issues collapse under the first path segment |
| `z.treeifyError(err)` | `{ errors, properties?: { k: tree }, items?: tree[] }` | nested UIs; walk with `?.` |
| `z.prettifyError(err)` | multi-line string with `→ at path` | logs, CLIs, thrown config errors |
| `err.flatten()`, `err.format()`, `z.formatError()` | Zod 3 shapes | deprecated; don't add new uses |

Walking a tree into dot paths, if you already have one:

```ts
type Tree = { errors: string[]; properties?: Record<string, Tree>; items?: (Tree | undefined)[] }
function walk(tree: Tree, path: string[] = [], out: Record<string, string[]> = {}) {
  if (tree.errors.length) out[path.join('.')] = tree.errors
  for (const [k, sub] of Object.entries(tree.properties ?? {})) walk(sub, [...path, k], out)
  tree.items?.forEach((sub, i) => sub && walk(sub, [...path, String(i)], out))
  return out
}
```

## Which errors are ZodErrors

- `safeParse(...).error` and `parse` throws: `z.ZodError` (also `instanceof z.core.$ZodError`).
- `z.function().implement()` argument/return failures: `z.core.$ZodError`, **not** `z.ZodError`.
- Sync parse of an async schema: `z.core.$ZodAsyncError` ("Encountered Promise during synchronous
  parse").
- `z.intersection()` merge conflicts and schema-construction mistakes (`.pick()` on a refined
  object, unknown keys in `.pick()`): plain `Error`, thrown when the schema is built or parsed.

Catch `z.core.$ZodError` if one handler must cover every validation failure.
