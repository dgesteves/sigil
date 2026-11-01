# Routing in Express 5 (router@2, path-to-regexp 8)

Applies to the path argument of `app.METHOD`, `app.all`, `app.use`, `app.route`, `router.METHOD`,
`router.all`, `router.use` and `router.route`. Behaviour below was checked against express@5.3.0 with
router@2.2.0 and path-to-regexp@8.4.2.

## Tokens

| Token | Meaning | Value in `req.params` |
| --- | --- | --- |
| `:name` | one parameter, up to the next `/` or the next literal token | decoded string |
| `:"any-name"` | parameter whose name is not a JS identifier | decoded string, key `any-name` |
| `*name` | one or more characters across segments | array of decoded segments |
| `{ ... }` | optional group; may contain literals and parameters | keys inside are absent when the group does not match |
| `\\(` etc. | escaped reserved character `( ) [ ] ? + !` | literal |

Reserved characters that used to mean something (`?`, `+`, `*` without a name, `(`, `)`, `[`, `]`)
now throw at registration time. The error message points at the index and links to
`https://git.new/pathToRegexpError`:

```text
Missing parameter name at index 9: /assets/*; visit https://git.new/pathToRegexpError for info
Unexpected ? at index 8: /:teamId?; visit https://git.new/pathToRegexpError for info
Unexpected ( at index 14: /teams/:teamId(\d+); visit https://git.new/pathToRegexpError for info
```

## Recipes

```js
// Nested path of any depth, e.g. /assets/img/brand/logo.svg
app.get('/assets/*assetPath', (req, res, next) => {
  res.sendFile(req.params.assetPath.join('/'), { root: ASSETS_ROOT }, (err) => err && next(err))
})

// Same, but /assets alone should also match (and serve a manifest)
app.get('/assets{/*assetPath}', (req, res, next) => {
  const relative = req.params.assetPath?.join('/') ?? 'manifest.json'
  res.sendFile(relative, { root: ASSETS_ROOT }, (err) => err && next(err))
})

// Optional extension
app.get('/invoices/:invoiceId{.:ext}', (req, res) => {
  const ext = req.params.ext ?? 'json'
  if (!['json', 'pdf', 'html'].includes(ext)) return res.sendStatus(404)
  // ...
})

// Optional trailing segment
app.get('/teams/:teamId/avatar{/:variant}', (req, res) => {
  const variant = req.params.variant ?? 'square'
  // ...
})

// Alternatives that used to be a regex group
app.get(['/discussion/:slug', '/page/:slug'], handler)

// Constrained parameter: validate in the handler (string syntax has no inline regex any more)
app.get('/teams/:teamId', (req, res, next) => {
  if (!/^\d+$/.test(req.params.teamId)) return next() // fall through to the 404 handler
  // ...
})

// RegExp routes still work; captures are numbered
app.get(/^\/legacy-teams\/(\d+)$/, (req, res) => res.redirect(301, `/teams/${req.params[0]}`))
```

## Matching details worth knowing

- `/*splat` needs at least one character after the slash: `/assets/*assetPath` does not match
  `/assets` or `/assets/`. `/assets{/*assetPath}` matches both and leaves `assetPath` absent.
- A wildcard right after a literal without a slash (`/all{*splat}`) captures the leading slash as an
  empty first segment: `/all/x/y` gives `['', 'x', 'y']`. Put the slash inside the group: `/all{/*splat}`.
- Each segment of a wildcard is decoded separately, so `a%2Fb` arrives as one segment `'a/b'`. When
  you turn segments back into a filesystem path, rely on `sendFile`'s `root` (it rejects `..` with 403)
  or normalise and check the resolved path stays inside the base directory.
- Trailing slashes are optional by default (`strict routing` off) and matching is case-insensitive by
  default (`case sensitive routing` off), as in Express 4.
- `req.params` for string paths has a null prototype: use `Object.hasOwn`, `in`, or spread it
  (`{ ...req.params }`) before passing it to code that calls `hasOwnProperty`.
- Unmatched optional keys are absent, not `undefined`. `Object.keys(req.params)` changes with the
  request.

## Routers, `mergeParams` and `app.param`

- `express.Router({ mergeParams: true })` still exposes the parent's params to a mounted router.
- `app.param('teamId', fn)` and `router.param('teamId', fn)` work as before.
  `router.param(['a', 'b'], fn)` throws `argument name must be a string`; `app.param` still accepts an
  array. The legacy `app.param(fn)` form that rewrote how params were parsed is gone.
- A leading colon in the name (`app.param(':teamId', fn)`) is no longer stripped: the callback
  silently never runs. Write `'teamId'`.

## TypeScript

With `@types/express@5` (5.0.x, backed by `@types/express-serve-static-core@5.1.x`) the route string
drives the type of `req.params` (checked with TypeScript 7.0):

```ts
app.get('/assets/*assetPath', (req, res) => {
  req.params.assetPath // string[]
})
app.get('/invoices/:invoiceId{.:ext}', (req, res) => {
  req.params.invoiceId // string
  req.params.ext // string | undefined
})
```

Handlers may return a promise (the handler type returns `unknown`), so `async` handlers type-check.
`req.body` is typed `any` by default even though it can be `undefined` at runtime; type it as
`unknown` and validate.
