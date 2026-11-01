# Cache Components recipes

For `next@16.4.3` with `cacheComponents: true` and `partialPrefetching: true`. Measured results are
marked; the rest follows the bundled docs (`dist/docs/01-app/01-getting-started/08-caching.md`,
`02-guides/migrating-to-cache-components.md`, `03-api-reference/01-directives/use-cache.md`).

## The mental model

- Nothing is cached unless you say so. `fetch`, database calls and file reads run per request.
- `next build` prerenders every route into a **static shell**: everything that finishes without
  request data. Cached scopes (`'use cache'`) are part of the shell; request-time parts must sit
  under a `<Suspense>` boundary, whose fallback goes into the shell and whose content streams in.
- A route that is all shell is served like a static file (`x-nextjs-cache: HIT`). A route with holes
  is Partial Prerendering: shell from cache, holes rendered per request.
- The build is the gate. It refuses routes that would block on request data outside Suspense.

## Recipe: cached detail page with a per-visitor header

```tsx
// app/layout.tsx
export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en">
      <body>
        <nav>
          <Suspense fallback={<a href="/basket">Basket</a>}>
            <BasketLink /> {/* reads cookies(): request time, per visitor */}
          </Suspense>
        </nav>
        {children}
      </body>
    </html>
  )
}

// app/listings/[slug]/page.tsx
import { cacheLife, cacheTag } from 'next/cache'

export const listingTag = (slug: string) => `listing:${slug}`

async function getListing(slug: string) {
  'use cache'
  cacheLife('hours')
  cacheTag(listingTag(slug))
  return db.listing.findUnique({ where: { slug } })
}

export default function ListingPage({ params }: PageProps<'/listings/[slug]'>) {
  return (
    <Suspense fallback={<ListingSkeleton />}>
      <Listing params={params} />
    </Suspense>
  )
}

async function Listing({ params }: Pick<PageProps<'/listings/[slug]'>, 'params'>) {
  const { slug } = await params
  const listing = await getListing(slug)
  if (!listing) notFound()
  return <ListingView listing={listing} />
}
```

Measured with this shape: repeat views do not call the data source again; different `cookie`
headers get their own header content; after the editing Server Action calls
`updateTag(listingTag(slug))` the very next view and every reload show the new data; after a webhook
calls `revalidateTag(listingTag(slug), 'max')` one view is stale and the following one is fresh.

Variants that also measured correct:

- the cached scope on the component instead of the data function:
  `async function ListingBody({ slug }) { 'use cache'; cacheTag(...); ... }` rendered as
  `{params.then(({ slug }) => <ListingBody slug={slug} />)}` inside Suspense;
- `unstable_cache(fn, keys, { tags, revalidate })` (still supported, persists across deploys);
- `revalidatePath('/listings/' + slug)` in the action or webhook (path-scoped, not tag-scoped).

Variants that measured wrong:

- `revalidateTag(tag, 'max')` in the editing action: the editor's first view after saving is stale.
- `updateTag(tag)` in the Route Handler: throws, the webhook returns 500, nothing is invalidated.
- `export const revalidate = 3600` on the page: build error under `cacheComponents`.

## Prerendering dynamic params (ISR)

```tsx
export async function generateStaticParams() {
  const top = await db.listing.findMany({ take: 100, orderBy: { views: 'desc' } })
  return top.map((l) => ({ slug: l.slug }))   // at least one entry, or the build fails
}
```

- Listed params are prerendered at build time; unlisted ones render on first request and then serve
  from cache. With Partial Prefetching the first visitor of an unlisted page gets the loading shell
  immediately (16.3+).
- `dynamicParams` is not supported: call `notFound()` for ids that don't resolve.
- Without `generateStaticParams`, `await params` must happen inside `<Suspense>`.

## Lifetimes

| Profile | stale | revalidate | expire |
| --- | --- | --- | --- |
| `default` (no `cacheLife` call) | 5 min | 15 min | never |
| `seconds` | 30 s | 1 s | 1 min |
| `minutes` | 5 min | 1 min | 1 h |
| `hours` | 5 min | 1 h | 1 day |
| `days` | 5 min | 1 day | 1 week |
| `weeks` | 5 min | 1 week | 30 days |
| `max` | 5 min | 30 days | 1 year |

- `stale` is the browser router cache (minimum 30 s); `revalidate` is when the server refreshes in the
  background; `expire` is when a request must wait for fresh data.
- Custom profiles go in `next.config.ts` under `cacheLife: { name: { stale, revalidate, expire } }`;
  omitted fields inherit from `default`; `expire` must be longer than `revalidate`.
- `revalidate: 0` or `expire` under 5 minutes excludes the scope from prerendering (a hole that
  needs Suspense). Only the `seconds` preset falls under that.
- A short-lived cache nested inside a `'use cache'` scope that has no explicit `cacheLife` fails the
  build. Put a `cacheLife` call in every scope.
- Call `cacheLife` once per invocation; branches may choose different profiles.

## Request data and caching

| Need | Pattern |
| --- | --- |
| per-user value inside cached UI | read `cookies()` outside, pass the value as an argument (it joins the key) |
| cannot refactor a helper that reads cookies | `'use cache: private'`: per-request reuse, never stored in a server cache, excluded from the shell |
| shared cache across instances (Redis, KV) | `'use cache: remote'` with a configured `cacheHandlers` entry |
| draft/preview content | `draftMode()` `isEnabled` may be read inside `'use cache'`; cached scopes re-run in draft mode |
| `Math.random()`, `Date.now()` per request | `await connection()` first, inside a Suspense boundary |
| synchronous database driver | `await connection()` before the query, or the query runs at build time |

## Escape hatches and guards (16.3-16.4)

- `export const instant = false` on a page, layout or slot: allows that segment to block instead of
  failing validation. It does not make the route dynamic and does not excuse synchronous IO.
- `export const ensureStatic = 'navigation' | 'prefetch' | 'shell'` (16.4): the build fails if dynamic
  content appears in that stage. Use it to keep marketing pages and blogs fully static.
- `await navigation()` / `await prefetch()` from `next/cache` (16.4): defer cached content out of
  prefetches or out of the shell.

## Debugging

- `next build` route table: `○` static, `◐` partial prerender, `ƒ` dynamic.
- Response header `x-nextjs-cache`: `HIT`, `STALE` (served old while refreshing), `MISS`.
- `NEXT_PRIVATE_DEBUG_CACHE=1 next start` logs cache reads, writes and revalidations.
- `next build --debug-prerender` gives readable stacks for prerender errors.
- Error to fix mapping:
  - "encountered uncached or runtime data during prerendering": add Suspense, `'use cache'`, or
    `instant = false`.
  - "`cookies()` can't be read inside `"use cache"`": move the read out and pass the value.
  - "Route segment config "X" is not compatible with `nextConfig.cacheComponents`": delete the export
    and express it with `cacheLife`.
