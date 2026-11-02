import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, describe, test } from 'node:test'
import { byTestId, decode, lastTestId, readJson, type Server, startServer, writeJson } from './harness.ts'

const SECRET = 'hidden-cms-secret'
type Post = { slug: string; title: string; date: string; body: string }

let server: Server
before(async () => {
  server = await startServer({ CMS_WEBHOOK_SECRET: SECRET })
})
after(() => server?.stop())

describe('build', () => {
  test('next build prints no deprecation or invalid-config warnings', () => {
    const log = readFileSync('test/hidden/build.log', 'utf8')
    const warnings = log.split('\n').filter((l) => /⚠/.test(l) && /deprecat|invalid|unrecognized|no longer supported/i.test(l))
    assert.deepEqual(warnings, [])
  })

  test('the upgrade stays on Next 16.4.3 with Turbopack', () => {
    const pkg = readJson<{ dependencies: Record<string, string>; scripts: Record<string, string> }>('package.json')
    assert.equal(pkg.dependencies.next, '16.4.3')
    assert.equal(readJson<{ version: string }>('node_modules/next/package.json').version, '16.4.3')
    assert.doesNotMatch(readFileSync('test/hidden/build.log', 'utf8'), /\(webpack\)/i)
  })
})

describe('pages', () => {
  test('home, posts index and post pages render as before', async () => {
    const home = await server.get('/')
    assert.equal(home.status, 200)
    assert.equal(lastTestId(home.html, 'latest'), 'Latest: Packing light for a week in the hills')
    assert.equal(byTestId((await server.get('/posts')).html, 'post').length, 5)
    const post = await server.get('/posts/night-navigation')
    assert.equal(post.status, 200)
    assert.equal(lastTestId(post.html, 'title'), 'Navigating after dark')
    assert.match(post.html, /<title>Navigating after dark \| Field Notes<\/title>/)
  })

  test('the theme cookie still sets the theme', async () => {
    assert.match((await server.get('/posts', 'theme=dark')).html, /<html lang="en" class="dark"/)
    assert.match((await server.get('/posts', 'theme=neon')).html, /<html lang="en" class="light"/)
  })

  test('the hero photo keeps quality 90', async () => {
    const { html } = await server.get('/')
    const img = /<img\b[^>]*alt="A ridge line at dawn"[^>]*>/.exec(html)?.[0]
    assert.ok(img, 'hero image missing from the home page')
    const srcset = decode(/\bsrcSet="([^"]*)"/i.exec(img)?.[1] ?? '')
    assert.match(srcset, /images\.fieldnotes\.dev%2Fhero%2Fridge-at-dawn\.jpg/)
    const qualities = [...srcset.matchAll(/[?&]q=(\d+)/g)].map((m) => m[1])
    assert.ok(qualities.length > 0, `no quality in srcset: ${srcset}`)
    assert.deepEqual([...new Set(qualities)], ['90'], `hero srcset requests quality ${[...new Set(qualities)].join(', ')}`)
  })
})

describe('post sitemaps', () => {
  test('/posts/sitemap/0.xml lists every post URL', async () => {
    const res = await server.get('/posts/sitemap/0.xml')
    assert.equal(res.status, 200)
    const locs = [...res.html.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1])
    const slugs = readJson<Post[]>('content/posts.json').map((p) => `https://fieldnotes.dev/posts/${p.slug}`)
    assert.deepEqual(locs, slugs)
  })
})

describe('CMS webhook', () => {
  const publish = (secret = SECRET) =>
    fetch(`${server.url}/api/revalidate`, { method: 'POST', headers: { 'x-cms-secret': secret } })

  test('a wrong secret is rejected and changes nothing', async () => {
    assert.equal((await publish('wrong')).status, 401)
  })

  test('the very next page view after the webhook shows the new content', async () => {
    // Warm the caches first, as production traffic would.
    await server.get('/')
    await server.get('/posts')
    const posts = readJson<Post[]>('content/posts.json')
    posts.unshift({ slug: 'winter-camp', title: 'Setting up a winter camp', date: '2026-10-30', body: 'Dig in.' })
    posts.find((p) => p.slug === 'trail-food')!.title = 'Trail food that survives a week in a backpack'
    writeJson('content/posts.json', posts)

    // Without the webhook, readers keep getting the cached posts.
    assert.equal(lastTestId((await server.get('/')).html, 'latest'), 'Latest: Packing light for a week in the hills')

    const res = await publish()
    assert.equal(res.status, 200, `webhook returned ${res.status}\n${server.output().slice(-1500)}`)

    assert.equal(lastTestId((await server.get('/')).html, 'latest'), 'Latest: Setting up a winter camp', 'first view after the webhook served stale posts')
    const index = byTestId((await server.get('/posts')).html, 'post')
    assert.equal(index.length, 6)
    assert.ok(index.includes('Trail food that survives a week in a backpack'))
    const fresh = await server.get('/posts/winter-camp')
    assert.equal(fresh.status, 200)
    assert.equal(lastTestId(fresh.html, 'title'), 'Setting up a winter camp')
  })
})
