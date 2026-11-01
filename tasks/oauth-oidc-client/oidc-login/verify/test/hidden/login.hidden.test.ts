import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { IdTokenTamper } from '../support/idp.ts'
import {
  finishLogin,
  login,
  PUBLIC_ORIGIN,
  type Portal,
  signInAtIdp,
  startLogin,
  startPortal,
  whoAmI,
} from '../support/portal.ts'

async function withPortal(fn: (portal: Portal) => Promise<void>): Promise<void> {
  const portal = await startPortal()
  try {
    await fn(portal)
  } finally {
    await portal.close()
  }
}

async function assertSignedOut(portal: Portal, browser: ReturnType<Portal['browser']>, why: string) {
  const me = await whoAmI(browser)
  assert.equal(me.status, 401, `${why}: expected to be signed out, /me says ${JSON.stringify(me.user)}`)
}

function codeGrants(portal: Portal, code: string): number {
  return portal.idp.tokenEvents.filter((e) => e.grantType === 'authorization_code' && e.code === code)
    .length
}

describe('the authorization request', () => {
  test('uses the code flow with PKCE S256 and the registered redirect URI', () =>
    withPortal(async (portal) => {
      const url = await startLogin(portal.browser())
      assert.equal(`${url.origin}${url.pathname}`, portal.idp.endpoint('auth'))
      const q = url.searchParams
      assert.equal(q.get('response_type'), 'code')
      assert.equal(q.get('client_id'), portal.config.oidc.clientId)
      assert.equal(q.get('redirect_uri'), portal.config.oidc.redirectUri)
      assert.ok(q.get('scope')?.split(' ').includes('openid'), 'scope must include openid')
      assert.equal(q.get('code_challenge_method'), 'S256')
      assert.match(q.get('code_challenge') ?? '', /^[A-Za-z0-9_-]{43}$/)
    }))

  test('every attempt gets its own PKCE challenge, state and nonce', () =>
    withPortal(async (portal) => {
      const a = (await startLogin(portal.browser())).searchParams
      const b = (await startLogin(portal.browser())).searchParams
      assert.notEqual(a.get('code_challenge'), b.get('code_challenge'))
      for (const name of ['state', 'nonce']) {
        if (a.has(name) || b.has(name)) assert.notEqual(a.get(name), b.get(name), `${name} reused`)
      }
    }))
})

describe('signing in', () => {
  test('stores the user from the ID token and redirects home', () =>
    withPortal(async (portal) => {
      const browser = portal.browser()
      const done = await login(browser, 'alice')
      assert.ok(done.status >= 300 && done.status < 400, `callback answered ${done.status}`)
      assert.equal(done.location, `${PUBLIC_ORIGIN}/`)
      const me = await whoAmI(browser)
      assert.equal(me.status, 200)
      assert.equal(me.user?.sub, 'f3a1c9e2-alice')
      assert.equal(me.user?.email, 'alice@example.com')
      assert.equal(me.user?.name, 'Alice Moreau')
    }))

  test('two partners signing in at the same time each get their own account', () =>
    withPortal(async (portal) => {
      const alice = portal.browser()
      const bob = portal.browser()
      const aliceAuth = await startLogin(alice)
      const bobAuth = await startLogin(bob)
      const aliceBack = await signInAtIdp(alice, aliceAuth, 'alice')
      const bobBack = await signInAtIdp(bob, bobAuth, 'bob')
      await finishLogin(bob, bobBack)
      await finishLogin(alice, aliceBack)
      assert.equal((await whoAmI(alice)).user?.email, 'alice@example.com')
      assert.equal((await whoAmI(bob)).user?.email, 'bob@example.com')
    }))

  test('a session id planted before sign-in is not signed in afterwards (no fixation)', () =>
    withPortal(async (portal) => {
      const attacker = portal.browser()
      await startLogin(attacker)
      const planted = attacker.cookies(PUBLIC_ORIGIN)
      const victim = portal.browser()
      for (const [name, value] of Object.entries(planted)) victim.setCookie(PUBLIC_ORIGIN, name, value)
      await login(victim, 'alice')
      assert.equal((await whoAmI(victim)).user?.email, 'alice@example.com')
      await assertSignedOut(portal, attacker, 'the planted session')
    }))
})

describe('the callback', () => {
  test('only works once', () =>
    withPortal(async (portal) => {
      const browser = portal.browser()
      const callback = await signInAtIdp(browser, await startLogin(browser), 'alice')
      await finishLogin(browser, callback)
      assert.equal((await whoAmI(browser)).user?.email, 'alice@example.com')
      const code = new URL(callback).searchParams.get('code') ?? ''

      await finishLogin(browser, callback)
      assert.equal(codeGrants(portal, code), 1, 'the replayed callback was exchanged at the IdP again')

      const stranger = portal.browser()
      await finishLogin(stranger, callback)
      await assertSignedOut(portal, stranger, 'replaying the callback in another browser')
    }))

  test('refuses a callback that this browser did not start (login CSRF / code injection)', () =>
    withPortal(async (portal) => {
      const attacker = portal.browser()
      const attackerCallback = await signInAtIdp(attacker, await startLogin(attacker), 'mallory')

      const victim = portal.browser()
      await startLogin(victim)
      await finishLogin(victim, attackerCallback)
      await assertSignedOut(portal, victim, 'the attacker callback with a login in progress')

      const fresh = portal.browser()
      await finishLogin(fresh, attackerCallback)
      await assertSignedOut(portal, fresh, 'the attacker callback with no login in progress')
    }))

  test('refuses a tampered state', () =>
    withPortal(async (portal) => {
      const browser = portal.browser()
      const callback = new URL(await signInAtIdp(browser, await startLogin(browser), 'alice'))
      if (!callback.searchParams.has('state')) return // PKCE-only clients have no state to tamper with
      callback.searchParams.set('state', `${callback.searchParams.get('state')}x`)
      await finishLogin(browser, callback.href)
      await assertSignedOut(portal, browser, 'a tampered state')
    }))

  test('checks the iss parameter (RFC 9207 mix-up defence)', () =>
    withPortal(async (portal) => {
      const wrong = portal.browser()
      const callback = new URL(await signInAtIdp(wrong, await startLogin(wrong), 'alice'))
      callback.searchParams.set('iss', 'https://idp.attacker.example/realms/acme')
      await finishLogin(wrong, callback.href)
      await assertSignedOut(portal, wrong, 'a callback with a foreign iss')

      const missing = portal.browser()
      const callback2 = new URL(await signInAtIdp(missing, await startLogin(missing), 'alice'))
      callback2.searchParams.delete('iss')
      await finishLogin(missing, callback2.href)
      await assertSignedOut(portal, missing, 'a callback without iss from an IdP that always sends it')
    }))

  test('handles a sign-in the user cancelled at the IdP', () =>
    withPortal(async (portal) => {
      portal.idp.failNextAuthorization('access_denied')
      const browser = portal.browser()
      const callback = await signInAtIdp(browser, await startLogin(browser), 'alice')
      assert.match(callback, /error=access_denied/)
      await finishLogin(browser, callback)
      await assertSignedOut(portal, browser, 'a cancelled sign-in')
    }))
})

describe('ID token validation', () => {
  const tampered: Record<string, IdTokenTamper> = {
    'issued for another client': { claims: (c) => ({ ...c, aud: 'reporting-ui' }) },
    'with an extra untrusted audience and no azp': {
      claims: (c) => ({ ...c, aud: [String(c.aud), 'reporting-ui'] }),
    },
    'from another issuer': {
      claims: (c) => ({ ...c, iss: String(c.iss).replace('/realms/acme', '/realms/sandbox') }),
    },
    expired: {
      claims: (c) => ({ ...c, iat: Number(c.iat) - 7200, auth_time: Number(c.iat) - 7200, exp: Number(c.iat) - 3600 }),
    },
    'unsigned (alg: none)': { signWith: 'none' },
    'signed with HS256, which the IdP does not use': {
      signWith: 'hs256-client-secret',
    },
  }

  for (const [name, tamper] of Object.entries(tampered)) {
    test(`an ID token ${name} does not sign anyone in`, () =>
      withPortal(async (portal) => {
        const browser = portal.browser()
        const auth = await startLogin(browser)
        const callback = await signInAtIdp(browser, auth, 'alice')
        portal.idp.tamperNextIdToken(tamper)
        await finishLogin(browser, callback)
        await assertSignedOut(portal, browser, `an ID token ${name}`)
      }))
  }

  test('an ID token whose nonce belongs to another sign-in does not sign anyone in', () =>
    withPortal(async (portal) => {
      const browser = portal.browser()
      const auth = await startLogin(browser)
      if (!auth.searchParams.has('nonce')) return // nonce is optional with PKCE; nothing to replay
      const callback = await signInAtIdp(browser, auth, 'alice')
      portal.idp.tamperNextIdToken({ claims: (c) => ({ ...c, nonce: 'n-0S6_WzA2Mj-from-another-login' }) })
      await finishLogin(browser, callback)
      await assertSignedOut(portal, browser, 'an ID token with a foreign nonce')
    }))

  test('the portal still signs people in after rejecting bad tokens', () =>
    withPortal(async (portal) => {
      const first = portal.browser()
      const callback = await signInAtIdp(first, await startLogin(first), 'alice')
      portal.idp.tamperNextIdToken({ signWith: 'none' })
      await finishLogin(first, callback)
      const second = portal.browser()
      await login(second, 'bob')
      assert.equal((await whoAmI(second)).user?.email, 'bob@example.com')
    }))
})

describe('logout', () => {
  test('ends our session and redirects to the IdP end-session endpoint', () =>
    withPortal(async (portal) => {
      const browser = portal.browser()
      await login(browser, 'alice')
      const signedInCookies = browser.cookies(PUBLIC_ORIGIN)
      const idToken = portal.idp.issuedIdTokens.at(-1)

      const out = await browser.post(`${PUBLIC_ORIGIN}/logout`)
      assert.ok(out.status >= 300 && out.status < 400, `logout answered ${out.status}`)
      const target = new URL(out.location ?? '')
      assert.equal(`${target.origin}${target.pathname}`, portal.idp.endpoint('logout'))
      assert.equal(target.searchParams.get('id_token_hint'), idToken)
      assert.equal(
        target.searchParams.get('post_logout_redirect_uri'),
        portal.config.oidc.postLogoutRedirectUri,
      )
      await assertSignedOut(portal, browser, 'after logout')

      // The session must be gone on the server, not only the cookie in this browser.
      const copy = portal.browser()
      for (const [name, value] of Object.entries(signedInCookies)) copy.setCookie(PUBLIC_ORIGIN, name, value)
      await assertSignedOut(portal, copy, 'the old session cookie after logout')
    }))
})
