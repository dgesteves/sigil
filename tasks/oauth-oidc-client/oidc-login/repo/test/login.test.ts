import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { PUBLIC_ORIGIN, type Portal, login, startPortal, whoAmI } from './support/portal.ts'

let portal: Portal

before(async () => {
  portal = await startPortal()
})

after(() => portal.close())

test('anonymous visitors are not signed in', async () => {
  const me = await whoAmI(portal.browser())
  assert.equal(me.status, 401)
})

test('a partner can sign in with the IdP', async () => {
  const browser = portal.browser()
  const done = await login(browser, 'alice')
  assert.ok(done.status >= 300 && done.status < 400, `callback answered ${done.status}: ${done.body}`)
  assert.equal(done.location, `${PUBLIC_ORIGIN}/`)
  const me = await whoAmI(browser)
  assert.equal(me.status, 200)
  assert.equal(me.user?.email, 'alice@example.com')
})
