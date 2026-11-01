# Boundary recipes (Zod 4)

Patterns for the places untrusted data enters a service. Each snippet runs on `zod@4.6.7`.

## Environment variables

Env values are strings or missing, deploy tools often export unset variables as `''`, and the
process should refuse to start with a message that lists every problem without printing secrets.

```ts
import * as z from 'zod'

const emptyAsMissing = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v)
const fromEnv = <T extends z.ZodType>(schema: T) => z.preprocess(emptyAsMissing, schema)
const decimal = z.string().trim().regex(/^\d+$/, 'must be a whole number').transform(Number)

const WorkerEnv = z.object({
  BIND_HOST: fromEnv(z.string().default('0.0.0.0')),
  SHARD_COUNT: fromEnv(decimal.pipe(z.int().min(1).max(256)).default(4)),
  CACHE_URL: fromEnv(z.url({ protocol: /^rediss?$/, error: 'must be a redis:// or rediss:// URL' })),
  OUTPUT_STYLE: fromEnv(z.enum(['json', 'pretty']).default('json')),
  VERBOSE_TRACES: fromEnv(z.stringbool().default(false)),
  PROXY_SUBNETS: fromEnv(
    z
      .string()
      .transform((s) => s.split(',').map((p) => p.trim()).filter(Boolean))
      .pipe(z.array(z.union([z.ipv4(), z.cidrv4()])))
      .default([]),
  ),
})

export function readEnv(source: Record<string, string | undefined> = process.env) {
  const result = WorkerEnv.safeParse(source)
  if (!result.success) {
    // Issues carry no input values by default, so credentials in CACHE_URL stay out of the log.
    throw new Error(`Refusing to start:\n${z.prettifyError(result.error)}`)
  }
  return result.data
}
```

Why not `z.coerce`: `z.coerce.number()` turns `''` into `0` and accepts `'0x1f'` and `'1e3'`;
`z.coerce.boolean()` turns `'false'` into `true`.

## Query strings

Routers hand you `string | string[] | undefined`. Coerce here and nowhere else.

```ts
const asArray = (v: unknown) => (v === undefined ? undefined : Array.isArray(v) ? v : [v])

export const SearchQuery = z.object({
  q: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(25),
  // ?tag=a&tag=b or ?tag=a
  tag: z.preprocess(asArray, z.array(z.string().min(1)).max(20).default([])),
  // ?sort=-created,name
  sort: z
    .string()
    .transform((s) => s.split(','))
    .pipe(z.array(z.enum(['created', '-created', 'name', '-name'])))
    .prefault('-created'), // prefault: the default goes through transform + pipe
  starred: z.stringbool().default(false),
})
```

`z.coerce.number()` is tolerable for paging only because `.min(1)` rejects the `0` that an empty
`?page=` becomes (the request fails instead of silently reading page 0). If empty should mean "use
the default", or `0` is a valid value, map `''` to `undefined` first.

## HTML form posts

Empty inputs are `''`, unchecked checkboxes are absent, checked ones are `'on'`.

```ts
const missingIfEmpty = (v: unknown) => (v === '' ? undefined : v)

export const DeliveryForm = z.object({
  nickname: z.preprocess(missingIfEmpty, z.string().trim().min(2, 'Use at least 2 characters').max(40).optional()),
  replyTo: z.preprocess(
    missingIfEmpty,
    z
      .string({ error: (iss) => (iss.input === undefined ? 'Add a reply-to address' : undefined) })
      .trim()
      .toLowerCase()
      .pipe(z.email('That address looks wrong')),
  ),
  delivery: z.object({
    street: z.preprocess(missingIfEmpty, z.string('Add a street')),
    zip: z.preprocess(missingIfEmpty, z.string('Add a ZIP code').regex(/^\d{5}$/, 'Use a 5-digit ZIP code')),
  }),
  giftWrap: z.stringbool({ truthy: ['on', 'true'], falsy: ['off', 'false'] }).default(false),
  homepage: z.preprocess(missingIfEmpty, z.url({ protocol: /^https?$/, error: 'Use an http(s) link' }).optional()),
})
```

Note `z.string('Add a ZIP code')` is a schema-level message, so it also answers for the `.regex()`
check unless that check has its own message (it does here).

Return `issuesByPath(result.error)` (dot paths, see the error reference) with a 422, and re-render
with `z.input<typeof DeliveryForm>` values.

## JSON bodies and webhooks

```ts
const When = z.iso.datetime({ offset: true }).transform((s) => new Date(s))

// z.object (strip), never strict: providers add fields without notice.
export const ShipmentEvent = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('shipment.dispatched'),
    trackingId: z.string(),
    carrier: z.string(),
    weightGrams: z.int().positive(),
    at: When,
  }),
  z.object({
    type: z.literal('shipment.delivered'),
    trackingId: z.string(),
    at: When,
    proofUrl: z.url({ protocol: /^https$/ }).optional(),
  }),
])

export function parseWebhook(raw: string) {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return { ok: false as const, status: 400, error: 'invalid_json' }
  }
  const result = ShipmentEvent.safeParse(json)
  if (!result.success) return { ok: false as const, status: 400, error: 'invalid_payload', issues: result.error.issues }
  return { ok: true as const, event: result.data }
}
```

Verify the signature over the raw body before parsing, and treat an unknown `type` as "acknowledge
and ignore" if the provider sends notification types you don't subscribe to: the discriminated union reports it
as one `invalid_union` issue at `['type']`, which is easy to detect.

## Model output and JSON Schema

```ts
const Triage = z.object({
  severity: z.enum(['low', 'high', 'critical']),
  component: z.string().min(1),
  summary: z.string().max(280),
  labels: z.array(z.string()).max(10),
})

const jsonSchema = z.toJSONSchema(Triage) // draft 2020-12; target: 'draft-07' | 'openapi-3.0' | ...
const parsed = Triage.safeParse(JSON.parse(modelText)) // still validate: providers can drift
```

- `z.toJSONSchema` describes the **output** type by default; pass `{ io: 'input' }` for request
  schemas with defaults or pipes (fields with defaults are then not `required`).
- Transforms, `z.date()`, `z.bigint()`, `z.map()`, `z.set()` and `z.custom()` have no JSON Schema
  form: conversion throws unless you pass `{ unrepresentable: 'any' }`. Keep a transform-free schema
  for the wire and map afterwards, or use a codec.
- Object schemas emit `additionalProperties: false` in output mode.
- `z.fromJSONSchema()` exists but is experimental.

## Codecs (4.1+)

Bidirectional transforms: `parse`/`z.decode` go input to output, `z.encode` goes back.

```ts
const isoDate = z.codec(z.iso.datetime(), z.date(), {
  decode: (s) => new Date(s),
  encode: (d) => d.toISOString(),
})

const Event = z.object({ name: z.string(), at: isoDate })
const event = Event.parse({ name: 'launch', at: '2026-01-15T10:30:00.000Z' }) // at: Date
const wire = z.encode(Event, event)                                          // at: string
```

## Validated functions

```ts
const transfer = z
  .function({ input: [z.object({ from: z.string(), to: z.string(), cents: z.int().positive() })], output: z.string() })
  .implement((req) => `${req.from}->${req.to}:${req.cents}`)

transfer({ from: 'a', to: 'b', cents: 5 }) // ok; bad input throws z.core.$ZodError (not z.ZodError)
```

Use `.implementAsync()` for async bodies.

## Performance notes

- Define schemas once at module scope, not inside handlers.
- `z.compile(schema)` (4.5+) returns a faster schema with the same API.
- `schema.validate(data)` / `z.validate(schema, data)` (4.5/4.6) return a boolean without building
  issues: use them for cheap pre-checks, `safeParse` when you need messages.
- `safeParse` reports every issue, so a million bad array items means a million issues: bound arrays
  with `.max()`.
