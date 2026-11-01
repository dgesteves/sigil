# Errors and production hardening for Express 5 APIs

## What reaches the error middleware

| Source | Reaches `(err, req, res, next)`? |
| --- | --- |
| `throw` in a sync handler or middleware | yes |
| `throw` / rejection in an `async` handler | yes (Express 5) |
| a promise the handler returns that rejects | yes (Express 5) |
| a promise the handler starts but does not return or await | **no**: unhandled rejection, request hangs, process may exit |
| error in a callback (`fs.readFile(p, cb)`), timer, event emitter, stream `'error'` | **no**, unless you call `next(err)` there |
| `next(err)` / `next(new Error())` | yes |
| body-parser failures (`express.json()`, `express.urlencoded()`) | yes, with `status` and `type` set |
| `res.status(invalid)` inside the error handler itself | goes to the built-in final handler (HTML with stack outside production) |

## Error classes

Keep HTTP concerns out of the domain layer: domain code throws domain errors, one function maps them.
The example answers with RFC 9457 problem details (`application/problem+json`); if the API already
has a documented error envelope, keep that envelope and reuse the structure.

```js
import { STATUS_CODES } from 'node:http'

const PROBLEM_TYPES = 'https://example.dev/probs'

export class ApiProblem extends Error {
  constructor(status, detail, { type = 'about:blank', extra } = {}) {
    super(detail)
    this.name = 'ApiProblem'
    this.status = status
    this.type = type
    this.expose = status < 500
    this.extra = extra
  }
}

// body-parser `err.type` → problem type for the client
const PARSER_PROBLEMS = {
  'entity.parse.failed': `${PROBLEM_TYPES}/unparseable-body`,
  'entity.too.large': `${PROBLEM_TYPES}/body-limit`,
  'parameters.too.many': `${PROBLEM_TYPES}/body-limit`,
  'querystring.parse.rangeError': `${PROBLEM_TYPES}/nesting-limit`,
  'charset.unsupported': `${PROBLEM_TYPES}/unsupported-encoding`,
  'encoding.unsupported': `${PROBLEM_TYPES}/unsupported-encoding`,
  'request.aborted': `${PROBLEM_TYPES}/aborted-request`,
  'request.size.invalid': `${PROBLEM_TYPES}/aborted-request`,
  'entity.verify.failed': `${PROBLEM_TYPES}/signature-mismatch`,
}

// One place that knows how errors become HTTP responses.
export function problemFor(err) {
  if (err instanceof ApiProblem) return err
  if (err instanceof MissingRecordError) return new ApiProblem(404, 'The record does not exist')
  if (err instanceof VersionConflictError) return new ApiProblem(409, 'The record changed; reload and retry')
  const status = err?.status ?? err?.statusCode
  if (Number.isInteger(status) && status >= 400 && status < 500) {
    return new ApiProblem(status, err.expose ? err.message : STATUS_CODES[status], { type: PARSER_PROBLEMS[err.type] })
  }
  return new ApiProblem(500, 'The server could not complete the request')
}

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err)
  const p = problemFor(err)
  if (p.status >= 500) (req.log ?? console).error(err) // pino-http's req.log, or console
  res
    .status(p.status)
    .type('application/problem+json')
    .json({ type: p.type, title: STATUS_CODES[p.status], status: p.status, detail: p.message, ...p.extra })
})
```

body-parser error statuses, from body-parser@2.4 and raw-body@3 sources:

| `err.type` | `err.status` | Cause |
| --- | --- | --- |
| `entity.parse.failed` | 400 | malformed JSON, or a JSON primitive with `strict: true` |
| `entity.too.large` | 413 | body over `limit` |
| `parameters.too.many` | 413 | urlencoded body over `parameterLimit` (default 1000) |
| `querystring.parse.rangeError` | 400 | urlencoded nesting deeper than `depth` (extended mode) |
| `charset.unsupported` | 415 | unsupported `charset` in `Content-Type` |
| `encoding.unsupported` | 415 | unsupported `Content-Encoding` (gzip, deflate and br are supported) |
| `request.aborted` | 400 | client went away mid-body |
| `request.size.invalid` | 400 | body length differs from `Content-Length` |
| `entity.verify.failed` | 403 | your `verify` option threw |
| `stream.encoding.set`, `stream.not.readable` | 500 | another middleware already consumed the stream |

These errors carry the raw request text on `err.body`. Never serialise the whole error object into a
response, and think twice before logging it where request bodies (PII, credentials) must not go.
Express 5.3's built-in final handler logs the full error object.

## Validation at the edge without dependencies

Use the project's schema library if it has one (zod, valibot, ajv, TypeBox). Otherwise a plain
function is fine; what matters is rejecting wrong types, not only missing fields.

```js
const ROLES = new Set(['viewer', 'editor', 'admin'])

function readMemberInput(body) {
  const invalid = []
  const handle = body?.handle
  const role = body?.role
  const seats = body?.seats ?? 1
  if (typeof handle !== 'string' || !/^[a-z0-9-]{1,39}$/.test(handle)) invalid.push({ pointer: '/handle', reason: 'lowercase letters, digits and hyphens, at most 39' })
  if (!ROLES.has(role)) invalid.push({ pointer: '/role', reason: `one of ${[...ROLES].join(', ')}` })
  if (!Number.isInteger(seats) || seats < 1 || seats > 50) invalid.push({ pointer: '/seats', reason: 'an integer from 1 to 50' })
  if (invalid.length) {
    throw new ApiProblem(422, 'The member could not be added', { type: `${PROBLEM_TYPES}/invalid-member`, extra: { invalid } })
  }
  return { handle, role, seats }
}

app.post('/teams/:teamId/members', async (req, res) => {
  const input = readMemberInput(req.body) // req.body may be undefined: the optional chaining handles it
  res.status(201).json(await members.add(req.params.teamId, input))
})
```

- `body?.x` covers `req.body === undefined` (no body or a non-JSON content type) as well as arrays and
  `null`.
- `'12'` is not an integer: clients that send numbers as strings get a client error, which is the
  point of a contract. Pick 400 or 422 to match the API's existing convention.
- Route params and query values are always strings (or arrays of strings, or nested objects with the
  extended parser). Convert and check them explicitly: `Number.parseInt`, `Number.isInteger`, length
  caps, allow-lists for enums.
- Only answer 415 if you check `req.is('application/json')` yourself; otherwise a missing or non-JSON
  body is simply invalid input.

## Hardening checklist with the reasons

| Setting | Why | How |
| --- | --- | --- |
| `x-powered-by` off | on by default; advertises the framework | `app.disable('x-powered-by')` |
| security headers | CSP, HSTS, nosniff, frame protections | `helmet()` if the project uses it (helmet 8.x as of Nov 2026); for JSON-only APIs at least `X-Content-Type-Options: nosniff` |
| body size limits | default JSON limit is 100kb; uploads need their own route-level parser | `express.json({ limit: '32kb' })`; a larger limit only on the route that needs it |
| `trust proxy` | wrong values make `req.ip`, `req.protocol` and `req.hostname` client-controlled | `app.set('trust proxy', 1)` behind exactly one proxy, or the proxy subnet(s) such as `'loopback, 10.0.0.0/8'`; `true` only when the last proxy overwrites `X-Forwarded-*` |
| query parser | `'extended'` builds nested objects from user input | keep the default `'simple'` unless clients need brackets; with `'extended'` pass a function to cap depth, e.g. `str => qs.parse(str, { depth: 2, arrayLimit: 20 })` (only if `qs` is a direct dependency) |
| static files | dotfiles are ignored by default in 5; keep it that way | allow only `/.well-known` explicitly |
| user-controlled file paths | traversal | `res.sendFile(relativePath, { root })`; never `path.join(root, input)` + absolute path |
| redirects to user input | open redirect | allow-list hosts or only accept relative paths starting with a single `/` |
| errors | stack traces and internal messages leak through the default handler outside production | custom error handler, generic 5xx message |
| 404s | the default 404 is an HTML page that echoes the path | `app.use((req, res) => ...)` last, in the API's format |
| rate limiting on auth routes | brute force | a limiter keyed on the real client IP (see `trust proxy`), e.g. `express-rate-limit` if present |
| listen errors | Express 5 passes `EADDRINUSE` to the callback | `app.listen(port, (err) => { if (err) throw err })` |

## Process-level safety nets

A request that leaves a rejected promise unhandled is a bug to fix, not to swallow. If the service has
a process-level handler, log and exit so the orchestrator restarts a clean process:

```js
process.on('unhandledRejection', (reason) => {
  console.error('unhandled rejection', reason)
  process.exit(1)
})
```

Do not add `process.on('uncaughtException', () => {})` to keep a corrupted process serving.
