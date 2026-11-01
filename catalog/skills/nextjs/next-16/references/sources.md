# Sources

Checked on 2026-11-01 against `next@16.4.3` (npm `latest`, published 2026-10-23) with
`react@19.3.1`, `react-dom@19.3.1`, `typescript@6.0.3` and Node 24.22 in `node:24-bookworm`.
Every behaviour marked measured was reproduced with `next build` and `next start` (Turbopack) in that
image, offline.

## Documentation bundled in the package (`node_modules/next/dist/docs/`)

- Upgrading to 16: `01-app/02-guides/upgrading/version-16.md`
- Caching (Cache Components): `01-app/01-getting-started/08-caching.md`
- Revalidating: `01-app/01-getting-started/09-revalidating.md`, `01-app/02-guides/how-revalidation-works.md`
- Migrating to Cache Components: `01-app/02-guides/migrating-to-cache-components.md`
- `use cache`, `use cache: private`, `use cache: remote`: `01-app/03-api-reference/01-directives/`
- `cacheLife`, `cacheTag`, `updateTag`, `revalidateTag`, `revalidatePath`, `refresh`, `connection`:
  `01-app/03-api-reference/04-functions/`
- `cacheComponents`, `cacheLife`, `serverActions`, `partialPrefetching` config:
  `01-app/03-api-reference/05-config/01-next-config-js/`
- Proxy: `01-app/01-getting-started/16-proxy.md`, `01-app/03-api-reference/03-file-conventions/proxy.md`
- Data security and Server Actions: `01-app/02-guides/data-security.md`,
  `01-app/02-guides/server-actions.md`, `01-app/03-api-reference/01-directives/use-server.md`
- Route segment config `instant`, `ensureStatic`: `01-app/03-api-reference/03-file-conventions/02-route-segment-config/`

## Release notes (nextjs.org/blog)

- Next.js 16 (2025-10-21): Cache Components, `updateTag`, `refresh`, `revalidateTag` profiles, proxy
- Next.js 16.1 (2025-12-18), 16.2 (2026-03-18): file system caching in dev, adapters, AGENTS.md
- Next.js 16.3 (2026-08-03): Partial Prefetching, Instant Navigations, `instant` config,
  `catchError`, `next/root-params`, version-matched docs for agents, TypeScript 7 support
- Next.js 16.4 (2026-10-06): Cache Components recommended for all apps and default in
  `create-next-app`, `ensureStatic`, `navigation()`/`prefetch()`, `next upgrade --agent`
- A security release was announced for 2026-11-03; check for a newer 16.4.x before pinning.

## Measured on 16.4.3 (not stated, or stated differently, in the docs)

- After a Server Action calls `revalidateTag(tag, 'max')`, the first full page load is served stale
  (`x-nextjs-cache: STALE`), a later one is fresh; with `updateTag(tag)`, `revalidateTag(tag,
  { expire: 0 })` or `revalidatePath(path)` the first load is fresh. Same pattern for
  `unstable_cache` tags without Cache Components, and `'hours'` behaves like `'max'`.
- `updateTag` in a Route Handler throws "updateTag can only be called from within a Server Action"
  and the route returns 500.
- The upgrade guide's "Before `revalidateTag('posts')` / After `revalidateTag('posts', 'max')`"
  changes behaviour; the `revalidateTag` reference documents the one-argument form as `{ expire: 0 }`.
- `sitemap({ id }: { id: number })` with `generateSitemaps` type-checks and builds, then emits `NaN`
  URLs. A page typed `{ params: { slug: string } }` that reads `params.slug` also type-checks and
  renders an empty value.
- `quality={90}` without `images.qualities` renders `q=75`; `/_next/image?…&q=90` returns 400.
- `.bind(null, id)` arguments appear in the HTML as `$ACTION_n:1` JSON and are accepted back when
  edited; closure-captured values are encrypted and edits have no effect.
- Errors quoted verbatim: "Both middleware file … and proxy file … are detected", "Route segment
  config is not allowed in Proxy file", "Proxy does not support Edge runtime", "Route segment config
  "revalidate" is not compatible with `nextConfig.cacheComponents`", "`cookies()` can't be read inside
  `"use cache"`", "Next.js encountered uncached or runtime data during prerendering", "Only async
  functions are allowed to be exported in a "use server" file", "Parallel route slots cannot render
  the same URLs", and the `partialPrefetching` warning.
- `unstable_cacheLife` / `unstable_cacheTag` are still exported by `next/cache` in 16.4.3 and log an
  error on first use.
- React's reply encoding: a `FormData` argument is sent as fields prefixed `_<n>_` followed by the
  root field `0`; sending `0` first yields an empty FormData on the server.
