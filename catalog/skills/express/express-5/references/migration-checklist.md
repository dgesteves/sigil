# Express 4 → 5 migration checklist

Run each search over the whole source tree (adjust `src` and the extensions to the project). Every
hit needs a decision, including code no test covers. The searches are deliberately broad: a few false
positives are cheaper than one silent 200.

```sh
SRC="src"   # or ".", excluding node_modules
```

## 1. Route strings that no longer parse (startup crash)

```sh
grep -rnE "\.(get|post|put|patch|delete|all|use|route)\(\s*['\"\`][^'\"\`]*(\*|\?|\+|\(|\[)" $SRC --include='*.js' --include='*.mjs' --include='*.cjs' --include='*.ts'
```

| Before | After | Note |
| --- | --- | --- |
| `app.get('*', h)` | `app.get('/{*splat}', h)` or `app.use(h)` | a catch-all 404 is just `app.use(h)` last |
| `app.use('*', h)` / `app.all('*', h)` | `app.use(h)` | |
| `'/assets/*'` + `req.params[0]` | `'/assets/*assetPath'` + `req.params.assetPath.join('/')` | array of decoded segments |
| `'/assets/*'` that must match `/assets` too | `'/assets{/*assetPath}'` | then `req.params.assetPath` may be absent |
| `'/:teamId?'` | `'{/:teamId}'` | key absent when not matched |
| `'/:invoiceId.:ext?'` | `'/:invoiceId{.:ext}'` | |
| `'/:teamId(\\d+)'` | `'/:teamId'` + check `/^\d+$/` in the handler, or a RegExp route | inline regex groups are gone |
| `'/(foo\|bar)/:slug'` | `['/foo/:slug', '/bar/:slug']` | |
| a literal `(`, `)`, `[`, `]`, `?`, `+`, `!` | escape it: `'/v\\(1\\)'` | |

Query strings never appear in route paths; a `?` in a route string was always the optional marker.

## 2. Removed APIs (TypeError when reached)

```sh
grep -rnE "\.del\(|req\.param\(|\.sendfile\(|acceptsCharset\(|acceptsEncoding\(|acceptsLanguage\(|static\.mime" $SRC
grep -rnE "(router|app)\.param\(\s*\[" $SRC     # router.param with an array throws; app.param still accepts one
grep -rnE "\.param\(\s*function" $SRC          # app.param(fn) / router.param(fn) signature was removed
grep -rnE "\.param\(\s*['\"]:" $SRC              # app.param(':teamId', fn) never runs now; drop the colon
```

| Before | After |
| --- | --- |
| `app.del(path, h)` | `app.delete(path, h)` |
| `req.param('teamId')` | `req.params.teamId` (or `req.body?.teamId`, `req.query.teamId`: pick the one the client actually uses) |
| `res.sendfile(p)` | `res.sendFile(relativePath, { root })` |
| `res.sendFile(p, { hidden: true })` / `{ from }` | `{ dotfiles: 'allow' }` / `{ root }` |
| `req.acceptsCharset(...)` etc. | `req.acceptsCharsets(...)`, `req.acceptsEncodings(...)`, `req.acceptsLanguages(...)` |
| `express.static.mime.lookup('json')` | `require('mime-types').lookup('json')` (only if `mime-types` is a direct dependency) |

## 3. Response helpers whose old signatures now misbehave

```sh
grep -rnE "res\.(send|sendStatus)\(\s*[0-9]{3}\s*\)" $SRC          # res.send(410) → 200 with body 410
grep -rnE "res\.(json|jsonp|send)\([^)]*,\s*[0-9]{3}\s*\)" $SRC     # res.json(obj, 202) → 200
grep -rnE "res\.(send|json)\(.*\?\s*[0-9]{3}\s*:\s*[0-9]{3}" $SRC   # res.send(isActive ? 200 : 410)
grep -rnE "redirect\([^)]*,\s*[0-9]{3}\s*\)" $SRC                    # res.redirect(url, 301) → throws
grep -rnE "(redirect|location)\(\s*['\"]back['\"]" $SRC              # 'back' is now a literal URL
grep -rnE "res\.status\(\s*(err|error|e)\.(status|statusCode)\s*\)" $SRC  # throws on undefined
```

| Before | After (same behaviour as Express 4) |
| --- | --- |
| `res.send(410)` | `res.sendStatus(410)` (status 410, body `Gone`) |
| `res.send(isActive ? 200 : 410)` | `res.sendStatus(isActive ? 200 : 410)` |
| `res.json(obj, 202)` | `res.status(202).json(obj)` |
| `res.send(body, 400)` | `res.status(400).send(body)` |
| `res.redirect('/signin', 301)` | `res.redirect(301, '/signin')` |
| `res.redirect('back')` | `res.redirect(req.get('Referrer') \|\| fallbackUrl)` |
| `res.status(err.status)` | `res.status(Number.isInteger(err.status) ? err.status : 500)` |

A multi-line call (`res.json(\n obj,\n 201\n)`) escapes single-line greps; also skim every `res.json(`
and `res.send(` with more than one argument.

## 4. Request parsing changes

```sh
grep -rnE "req\.query(\.[a-zA-Z_]+|\[[^]]+\])?\s*=[^=]" $SRC     # writes to req.query are lost or throw
grep -rnE "req\.query\.[a-zA-Z_]+\.[a-zA-Z_]+|req\.query\[[^]]+\]\[|req\.query\.[a-zA-Z_]+\s*(\|\||\?\?)\s*\{" $SRC  # nested reads need 'extended'
grep -rnE "urlencoded\(\s*\)|urlencoded\(\{[^}]*\}\)" $SRC         # check the extended option
grep -rnE "req\.body\.[a-zA-Z_]|\{[^}]*\}\s*=\s*req\.body\b" $SRC  # reads that assume req.body is an object
grep -rnE "hasOwnProperty" $SRC                                    # on req.params (null prototype)
grep -rnE "req\.host\b" $SRC                                       # now includes the port
```

| Situation | Express 5 fix |
| --- | --- |
| clients send `where[state]=open` or `tags[]=a` | `app.set('query parser', 'extended')` (or a function, e.g. `str => qs.parse(str, { depth: 2 })`) |
| code writes `req.query.perPage = ...` | compute `const perPage = ...` locally; pass along via arguments or `res.locals` |
| forms post nested fields `contact[phone]=` | `express.urlencoded({ extended: true })` |
| `express.urlencoded()` with flat forms only | fine as is; set `{ extended: false }` explicitly to document it |
| route without a guaranteed body reads `req.body.handle` | `req.body?.handle` or `const { handle } = req.body ?? {}` |
| `req.params.hasOwnProperty('x')` | `Object.hasOwn(req.params, 'x')` |
| `req.host` used as a hostname | `req.hostname` |

Remember that `?a=1&a=2` is an array even with the simple parser. Validate types, don't assume strings.

## 5. Static files and downloads

```sh
grep -rnE "express\.static\(|serve-static|sendFile\(|download\(" $SRC
```

- Dotfiles and dot-directories are ignored (404) by default in `express.static`, and `sendFile`'s
  dotfiles check now also covers hidden directories in the path. Serve `/.well-known` explicitly:
  `app.use('/.well-known', express.static('public/.well-known', { dotfiles: 'allow' }))`.
- `.js` is served as `text/javascript` (newer `mime-db`). MIME changes can happen in minor releases.
- Since 5.3.0, `Content-Disposition` filenames that are valid HTTP tokens are no longer quoted; update
  tests that compare the header byte for byte.

## 6. Error handling and async code

```sh
grep -rnE "express-async-errors|express-async-handler|asyncHandler\(" $SRC package.json
grep -rnE "\.then\(" $SRC        # handlers that start a promise without returning or awaiting it
grep -rnE "\(\s*err\s*,\s*req\s*,\s*res\s*\)\s*=>|function\s*\w*\(\s*err\s*,\s*req\s*,\s*res\s*\)" $SRC  # 3-arg error handlers
```

- Async handlers that return or await their promise need no wrapper. A pass-through wrapper
  (`fn => (req, res, next) => fn(req, res, next).catch(next)`) is harmless; remove it only when asked.
- A `.then()` chain that is not returned still escapes Express: return it or `await` it.
- The default error handler now logs the full error object (5.3.0) and replies with the stack in HTML
  unless `NODE_ENV=production`. Install a JSON error handler.

## 7. Settings and server

- `app.listen(port, cb)`: `cb(err)` receives `EADDRINUSE` and similar instead of a throw. Handle it.
- `app.router` exists again as a reference to the base router; nothing to load.
- `DEBUG=express:*` no longer shows routing; use `DEBUG=express:*,router,router:*`.
- `res.render` is always asynchronous.
- `res.vary()` without a field throws.

## 8. Verify

1. Start the server once (`node <entry file>`, the file behind the `start` script) to prove every
   route string parses.
2. Run the test suite. Add tests for: status codes of every changed `send`/`json`/`redirect`, a request
   without a body to each POST/PUT/PATCH route, nested query and form input, unknown routes, and an
   error thrown from an async handler.
3. Check `npm ls express` resolves the app's own copy to 5.x.
