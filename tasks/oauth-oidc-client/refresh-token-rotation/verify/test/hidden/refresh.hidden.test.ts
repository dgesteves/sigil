import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { Session, SessionStore } from '../../src/session-store.ts'
import { type Env, startEnv } from '../support/env.ts'
import { defaultUsers } from '../support/idp.ts'

const [alice, bob] = defaultUsers

/** Behaves like the Redis store: values are copied, and every call takes a network round trip. */
class RoundTripStore implements SessionStore {
  readonly #data = new Map<string, string>()
  readonly #rtt = () => new Promise((resolve) => setTimeout(resolve, 2))

  async get(id: string): Promise<Session | undefined> {
    await this.#rtt()
    const raw = this.#data.get(id)
    return raw === undefined ? undefined : (JSON.parse(raw) as Session)
  }

  async set(id: string, session: Session): Promise<void> {
    await this.#rtt()
    this.#data.set(id, JSON.stringify(session))
  }

  async delete(id: string): Promise<void> {
    await this.#rtt()
    this.#data.delete(id)
  }
}

async function withEnv(fn: (env: Env, store: RoundTripStore) => Promise<void>): Promise<void> {
  const store = new RoundTripStore()
  const env = await startEnv({ sessions: store })
  try {
    await fn(env, store)
  } finally {
    await env.close()
  }
}

async function json(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    return { text }
  }
}

function assertNoReuse(env: Env): void {
  const reused = env.idp.refreshGrants().filter((e) => e.reuseDetected)
  assert.equal(
    reused.length,
    0,
    `a refresh token that had already been rotated was sent to the IdP ${reused.length} time(s); the IdP revoked the login`,
  )
}

async function assertSessionUsable(env: Env, store: RoundTripStore, sid: string): Promise<Session> {
  const session = await store.get(sid)
  assert.ok(session, 'the session must still exist')
  assert.equal(
    env.idp.refreshTokenStatus(session.tokens.refreshToken),
    'active',
    'the stored refresh token must be the current one',
  )
  assert.ok(env.idp.checkAccessToken(session.tokens.accessToken), 'the stored access token must be live')
  return session
}

describe('refreshing access tokens', () => {
  test('a valid access token is used as it is', () =>
    withEnv(async (env) => {
      const sid = await env.signIn(alice)
      const res = await env.request('/api/invoices', sid)
      assert.equal(res.status, 200)
      assert.equal(env.idp.refreshGrants().length, 0, 'no refresh is needed for a fresh token')
    }))

  test('an expired access token is refreshed and the rotated tokens are stored', () =>
    withEnv(async (env, store) => {
      const sid = await env.signIn(alice, { accessTokenTtl: -60 })
      const before = await store.get(sid)
      const res = await env.request('/api/invoices', sid)
      assert.equal(res.status, 200, `expected 200, got ${res.status} ${JSON.stringify(await json(res))}`)
      assert.equal((env.upstream.calls.at(-1)?.accepted), true)

      const after = await assertSessionUsable(env, store, sid)
      assert.notEqual(after.tokens.accessToken, before?.tokens.accessToken)
      assert.notEqual(after.tokens.refreshToken, before?.tokens.refreshToken)
      assert.ok(after.tokens.expiresAt > Date.now() + 60_000, 'expiresAt must describe the new token')
      assert.deepEqual(after.user, before?.user)
      assert.equal(env.idp.refreshTokenStatus(before?.tokens.refreshToken ?? ''), 'used')
      assertNoReuse(env)
    }))

  test('a token that expires within 30 seconds is refreshed ahead of time', () =>
    withEnv(async (env) => {
      const soon = await env.signIn(alice, { accessTokenTtl: 10 })
      assert.equal((await env.request('/api/invoices', soon)).status, 200)
      assert.equal(env.idp.refreshGrants().length, 1, 'a token with 10s left must be refreshed')

      const later = await env.signIn(bob, { accessTokenTtl: 300 })
      assert.equal((await env.request('/api/invoices', later)).status, 200)
      assert.equal(env.idp.refreshGrants().length, 1, 'a token with 5 minutes left must not be refreshed')
    }))

  test('each refresh uses the refresh token the previous one returned', () =>
    withEnv(async (env, store) => {
      // Short-lived tokens: every request finds its token about to expire.
      env.idp.setAccessTokenTtl(5)
      const sid = await env.signIn(alice, { accessTokenTtl: -60 })
      for (let i = 0; i < 3; i++) {
        const res = await env.request('/api/invoices', sid)
        assert.equal(res.status, 200, `request ${i + 1} answered ${res.status}`)
      }
      assert.equal(env.idp.refreshGrants().length, 3)
      assert.ok(env.idp.refreshGrants().every((e) => e.ok))
      assertNoReuse(env)
      await assertSessionUsable(env, store, sid)
    }))

  test('logout still sends the ID token hint after a refresh', () =>
    withEnv(async (env, store) => {
      const sid = await env.signIn(alice, { accessTokenTtl: -60 })
      const idToken = (await store.get(sid))?.tokens.idToken
      assert.ok(idToken)
      assert.equal((await env.request('/api/invoices', sid)).status, 200)
      assert.equal(env.idp.refreshGrants().length, 1)
      const res = await env.request('/logout', sid, { method: 'POST' })
      const target = new URL(res.headers.get('location') ?? '')
      assert.equal(`${target.origin}${target.pathname}`, env.idp.endpoint('logout'))
      assert.equal(target.searchParams.get('id_token_hint'), idToken)
    }))
})

describe('concurrent requests', () => {
  test('one dashboard load with an expired token (three parallel API calls) works', () =>
    withEnv(async (env, store) => {
      const sid = await env.signIn(alice, { accessTokenTtl: -60 })
      const res = await env.request('/api/dashboard', sid)
      const body = await json(res)
      assert.equal(res.status, 200, `dashboard answered ${res.status} ${JSON.stringify(body)}`)
      assert.equal((body.account as { sub?: string } | undefined)?.sub, alice.sub)
      assertNoReuse(env)
      await assertSessionUsable(env, store, sid)
    }))

  test('ten requests at once share one refresh', () =>
    withEnv(async (env, store) => {
      const sid = await env.signIn(alice, { accessTokenTtl: -60 })
      const replies = await Promise.all(
        Array.from({ length: 10 }, () => env.request('/api/invoices', sid)),
      )
      assert.deepEqual(
        replies.map((r) => r.status),
        Array(10).fill(200),
      )
      assertNoReuse(env)
      await assertSessionUsable(env, store, sid)
      // A later burst must not refresh again.
      const before = env.idp.refreshGrants().length
      await Promise.all(Array.from({ length: 5 }, () => env.request('/api/dashboard', sid)))
      assert.equal(env.idp.refreshGrants().length, before, 'a fresh token must not be refreshed again')
    }))

  test('two users refreshing at the same time each keep their own tokens', () =>
    withEnv(async (env, store) => {
      const a = await env.signIn(alice, { accessTokenTtl: -60 })
      const b = await env.signIn(bob, { accessTokenTtl: -60 })
      const [ra, rb] = await Promise.all([
        env.request('/api/dashboard', a),
        env.request('/api/dashboard', b),
      ])
      assert.equal(ra.status, 200)
      assert.equal(rb.status, 200)
      assert.equal(((await json(ra)).account as { sub: string }).sub, alice.sub)
      assert.equal(((await json(rb)).account as { sub: string }).sub, bob.sub)
      assertNoReuse(env)
      const sa = await assertSessionUsable(env, store, a)
      const sb = await assertSessionUsable(env, store, b)
      assert.equal(env.idp.checkAccessToken(sa.tokens.accessToken)?.sub, alice.sub)
      assert.equal(env.idp.checkAccessToken(sb.tokens.accessToken)?.sub, bob.sub)
    }))
})

describe('when refreshing fails', () => {
  test('a revoked login means signing in again', () =>
    withEnv(async (env, store) => {
      const sid = await env.signIn(alice, { accessTokenTtl: -60 })
      env.idp.revokeUserSessions(alice.sub)
      const res = await env.request('/api/invoices', sid)
      assert.equal(res.status, 401)
      assert.deepEqual(await json(res), { error: 'login_required' })
      assert.equal(await store.get(sid), undefined, 'the session must be deleted')

      const attempts = env.idp.refreshGrants().length
      const again = await env.request('/api/dashboard', sid)
      assert.equal(again.status, 401)
      assert.equal(env.idp.refreshGrants().length, attempts, 'no refresh without a session')
    }))

  test('a dashboard load with a revoked login answers 401 and deletes the session', () =>
    withEnv(async (env, store) => {
      const sid = await env.signIn(alice, { accessTokenTtl: -60 })
      env.idp.revokeUserSessions(alice.sub)
      const res = await env.request('/api/dashboard', sid)
      assert.equal(res.status, 401)
      assert.deepEqual(await json(res), { error: 'login_required' })
      assert.equal(await store.get(sid), undefined)
    }))

  test('a temporary IdP outage answers 503 and keeps the session', () =>
    withEnv(async (env, store) => {
      const sid = await env.signIn(alice, { accessTokenTtl: -60 })
      const before = await store.get(sid)
      env.idp.startOutage(503)
      const res = await env.request('/api/invoices', sid)
      assert.equal(res.status, 503)
      env.idp.endOutage()
      const kept = await store.get(sid)
      assert.ok(kept, 'the session must survive an IdP outage')
      assert.equal(kept.tokens.refreshToken, before?.tokens.refreshToken)

      const retry = await env.request('/api/invoices', sid)
      assert.equal(retry.status, 200, 'the next request must refresh once the IdP is back')
      assertNoReuse(env)
      await assertSessionUsable(env, store, sid)
    }))

  test('an outage during a dashboard load does not wedge later requests', () =>
    withEnv(async (env, store) => {
      const sid = await env.signIn(alice, { accessTokenTtl: -60 })
      env.idp.startOutage(503)
      const res = await env.request('/api/dashboard', sid)
      assert.ok(res.status >= 500, `expected a 5xx during the outage, got ${res.status}`)
      env.idp.endOutage()
      assert.ok(await store.get(sid), 'the session must survive an IdP outage')
      const retry = await env.request('/api/dashboard', sid)
      assert.equal(retry.status, 200)
      assertNoReuse(env)
      await assertSessionUsable(env, store, sid)
    }))
})
