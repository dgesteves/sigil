import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { defaultUsers } from './support/idp.ts'
import { type Env, startEnv } from './support/env.ts'

const [alice] = defaultUsers
let env: Env

before(async () => {
  env = await startEnv()
})

after(() => env.close())

test('the dashboard shows the signed-in user’s billing data', async () => {
  const sid = await env.signIn(alice)
  const res = await env.request('/api/dashboard', sid)
  assert.equal(res.status, 200)
  const body = (await res.json()) as { account: { sub: string }; invoices: { owner: string } }
  assert.equal(body.account.sub, alice.sub)
  assert.equal(body.invoices.owner, alice.sub)
})

test('without a session the dashboard asks for a sign-in', async () => {
  const res = await env.request('/api/dashboard')
  assert.equal(res.status, 401)
  assert.deepEqual(await res.json(), { error: 'login_required' })
})

test('logout ends the session at the IdP too', async () => {
  const sid = await env.signIn(alice)
  const res = await env.request('/logout', sid, { method: 'POST' })
  assert.equal(res.status, 302)
  const target = new URL(res.headers.get('location') ?? '')
  assert.equal(`${target.origin}${target.pathname}`, env.idp.endpoint('logout'))
  assert.ok(target.searchParams.get('id_token_hint'))
  assert.equal(await env.sessions.get(sid), undefined)
})
