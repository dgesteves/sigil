import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { byTestId, lastTestId, type Server, startServer } from './harness.ts'

let server: Server
before(async () => {
  server = await startServer({ CMS_WEBHOOK_SECRET: 'local-cms-secret' })
})
after(() => server?.stop())

test('home shows the latest post', async () => {
  const { status, html } = await server.get('/')
  assert.equal(status, 200)
  assert.equal(lastTestId(html, 'latest'), 'Latest: Packing light for a week in the hills')
})

test('the posts index lists every post', async () => {
  const { html } = await server.get('/posts')
  assert.equal(byTestId(html, 'post').length, 5)
})

test('post pages render', async () => {
  const { status, html } = await server.get('/posts/river-crossings')
  assert.equal(status, 200)
  assert.equal(lastTestId(html, 'title'), 'Reading a river before you cross it')
  assert.equal((await server.get('/posts/no-such-post')).status, 404)
})

test('the theme cookie sets the class on <html>', async () => {
  assert.match((await server.get('/')).html, /<html lang="en" class="light"/)
  assert.match((await server.get('/', 'theme=dark')).html, /<html lang="en" class="dark"/)
})

test('the webhook rejects requests without the secret', async () => {
  const res = await fetch(`${server.url}/api/revalidate`, { method: 'POST' })
  assert.equal(res.status, 401)
})
