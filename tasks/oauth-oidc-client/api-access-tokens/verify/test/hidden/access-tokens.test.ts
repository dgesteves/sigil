import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { createApp } from '../../src/app.ts'
import { listen } from '../support/http.ts'
import { TestIdp } from '../support/idp.ts'

const audience = 'https://shipments.api.acme.test'
const READ_WRITE = 'shipments:read shipments:write'

interface Env {
  idp: TestIdp
  url: string
}

async function withEnv(fn: (env: Env) => Promise<void>): Promise<void> {
  const idp = await TestIdp.start({ apiAudience: audience })
  const api = await listen(createApp({ issuer: idp.issuer, audience }))
  try {
    await fn({ idp, url: api.url })
  } finally {
    await api.close()
    await idp.close()
  }
}

interface Reply {
  status: number
  challenge: string
  body: unknown
}

async function call(
  env: Env,
  token: string | undefined,
  opts: { method?: 'GET' | 'POST'; authorization?: string } = {},
): Promise<Reply> {
  const method = opts.method ?? 'GET'
  const headers: Record<string, string> = {}
  if (opts.authorization !== undefined) headers.authorization = opts.authorization
  else if (token !== undefined) headers.authorization = `Bearer ${token}`
  if (method === 'POST') headers['content-type'] = 'application/json'
  const res = await fetch(`${env.url}/v1/shipments`, {
    method,
    headers,
    body: method === 'POST' ? JSON.stringify({ destination: 'Gdansk' }) : undefined,
  })
  const text = await res.text()
  let body: unknown = text
  try {
    body = JSON.parse(text)
  } catch {}
  return { status: res.status, challenge: res.headers.get('www-authenticate') ?? '', body }
}

function destinations(reply: Reply): string[] {
  const shipments = (reply.body as { shipments?: { destination: string }[] }).shipments ?? []
  return shipments.map((s) => s.destination)
}

function assertBearerChallenge(reply: Reply, error?: string): void {
  assert.match(reply.challenge, /^Bearer\b/i, 'a 401/403 must carry a Bearer WWW-Authenticate challenge')
  if (error) assert.match(reply.challenge, new RegExp(`error="${error}"`))
}

function assertRejected(reply: Reply): void {
  assert.equal(reply.status, 401, `expected 401, got ${reply.status}: ${JSON.stringify(reply.body)}`)
  assertBearerChallenge(reply, 'invalid_token')
}

describe('valid access tokens', () => {
  test('are accepted, and the caller is the token subject', () =>
    withEnv(async (env) => {
      const alice = await env.idp.accessToken({ sub: 'carrier-alice', scope: READ_WRITE })
      const bob = await env.idp.accessToken({ sub: 'carrier-bob', scope: READ_WRITE })
      assert.equal((await call(env, alice, { method: 'POST' })).status, 201)
      const mine = await call(env, alice)
      assert.equal(mine.status, 200)
      assert.deepEqual(destinations(mine), ['Gdansk'])
      const theirs = await call(env, bob)
      assert.equal(theirs.status, 200)
      assert.deepEqual(destinations(theirs), [])
    }))

  test('may list several audiences, one of them this API', () =>
    withEnv(async (env) => {
      const token = await env.idp.accessToken({
        aud: ['https://reporting.api.acme.test', audience],
        scope: READ_WRITE,
      })
      assert.equal((await call(env, token)).status, 200)
    }))

  test('signed with ES256 by a second published key are accepted', () =>
    withEnv(async (env) => {
      const kid = await env.idp.publishNextKey('ES256')
      const rs256 = await env.idp.accessToken({ scope: READ_WRITE })
      assert.equal((await call(env, rs256)).status, 200)
      env.idp.activateKey(kid)
      const es256 = await env.idp.accessToken({ scope: READ_WRITE })
      assert.equal((await call(env, es256)).status, 200)
    }))
})

describe('missing credentials', () => {
  test('no Authorization header gets 401 with a Bearer challenge', () =>
    withEnv(async (env) => {
      const reply = await call(env, undefined)
      assert.equal(reply.status, 401)
      assertBearerChallenge(reply)
    }))

  test('another auth scheme gets 401', () =>
    withEnv(async (env) => {
      const reply = await call(env, undefined, { authorization: 'Basic c2hpcHBlcjpodW50ZXIy' })
      assert.equal(reply.status, 401)
      assertBearerChallenge(reply)
    }))
})

describe('forged, expired and misdirected tokens are rejected', () => {
  test('a string that is not a JWT', () =>
    withEnv(async (env) => {
      assertRejected(await call(env, 'not-a-jwt'))
      assertRejected(await call(env, 'eyJhbGciOiJSUzI1NiJ9.e30.c2ln'))
    }))

  test('an unsecured token (alg: none)', () =>
    withEnv(async (env) => {
      const token = await env.idp.sign(
        {
          iss: env.idp.issuer,
          sub: 'intruder',
          aud: audience,
          exp: Math.floor(Date.now() / 1000) + 300,
          iat: Math.floor(Date.now() / 1000),
          jti: 'none-1',
          client_id: 'shipments-web',
          scope: READ_WRITE,
        },
        { typ: 'at+jwt' },
        { signWith: 'none' },
      )
      assertRejected(await call(env, token))
    }))

  test('HS256 tokens keyed with the public signing key', () =>
    withEnv(async (env) => {
      const claims = {
        iss: env.idp.issuer,
        sub: 'intruder',
        aud: audience,
        exp: Math.floor(Date.now() / 1000) + 300,
        iat: Math.floor(Date.now() / 1000),
        jti: 'hs-1',
        client_id: 'shipments-web',
        scope: READ_WRITE,
      }
      // Warm up any key cache first, so the forgery is checked against known keys.
      assert.equal((await call(env, await env.idp.accessToken({ scope: READ_WRITE }))).status, 200)
      for (const signWith of ['hs256-public-pem', 'hs256-public-jwk'] as const) {
        const token = await env.idp.sign(claims, { typ: 'at+jwt' }, { signWith })
        assertRejected(await call(env, token))
      }
    }))

  test('a token signed by another key that reuses the IdP key id', () =>
    withEnv(async (env) => {
      assert.equal((await call(env, await env.idp.accessToken({ scope: READ_WRITE }))).status, 200)
      const now = Math.floor(Date.now() / 1000)
      const token = await env.idp.sign(
        {
          iss: env.idp.issuer,
          sub: 'intruder',
          aud: audience,
          exp: now + 300,
          iat: now,
          jti: 'foreign-1',
          client_id: 'shipments-web',
          scope: READ_WRITE,
        },
        { typ: 'at+jwt' },
        { signWith: 'foreign-key' },
      )
      assertRejected(await call(env, token))
    }))

  test('an expired token', () =>
    withEnv(async (env) => {
      const now = Math.floor(Date.now() / 1000)
      const token = await env.idp.accessToken({ scope: READ_WRITE, iat: now - 1200, exp: now - 600 })
      assertRejected(await call(env, token))
    }))

  test('a token that is not valid yet (nbf)', () =>
    withEnv(async (env) => {
      const now = Math.floor(Date.now() / 1000)
      const token = await env.idp.accessToken({ scope: READ_WRITE, nbf: now + 600 })
      assertRejected(await call(env, token))
    }))

  test('a token without an expiry', () =>
    withEnv(async (env) => {
      const token = await env.idp.accessToken({ scope: READ_WRITE, exp: undefined })
      assertRejected(await call(env, token))
    }))

  test('a token from another issuer', () =>
    withEnv(async (env) => {
      const token = await env.idp.accessToken({
        scope: READ_WRITE,
        iss: `${env.idp.issuer.replace('/realms/acme', '/realms/sandbox')}`,
      })
      assertRejected(await call(env, token))
    }))

  test('a token for another API', () =>
    withEnv(async (env) => {
      const token = await env.idp.accessToken({
        scope: READ_WRITE,
        aud: 'https://payments.api.acme.test',
      })
      assertRejected(await call(env, token))
    }))

  test('an ID token presented as an access token', () =>
    withEnv(async (env) => {
      const user = [...env.idp.users.values()][0]
      const idToken = await env.idp.idToken('shipments-web', user, { scope: READ_WRITE })
      assertRejected(await call(env, idToken))
    }))

  test('a JWT that is not typed as an access token (RFC 9068 typ)', () =>
    withEnv(async (env) => {
      const token = await env.idp.accessToken({ scope: READ_WRITE }, { typ: 'JWT' })
      assertRejected(await call(env, token))
    }))

  test('the API keeps serving valid tokens after rejecting bad ones', () =>
    withEnv(async (env) => {
      assertRejected(await call(env, 'garbage.garbage.garbage'))
      assert.equal((await call(env, await env.idp.accessToken({ scope: READ_WRITE }))).status, 200)
    }))
})

describe('scopes', () => {
  test('a read-only token can list but not create', () =>
    withEnv(async (env) => {
      const token = await env.idp.accessToken({ scope: 'openid shipments:read' })
      assert.equal((await call(env, token)).status, 200)
      const reply = await call(env, token, { method: 'POST' })
      assert.equal(reply.status, 403)
      assertBearerChallenge(reply, 'insufficient_scope')
    }))

  test('scopes are matched exactly, not by prefix', () =>
    withEnv(async (env) => {
      const token = await env.idp.accessToken({ scope: 'shipments:readonly shipments:writer' })
      assert.equal((await call(env, token)).status, 403)
      assert.equal((await call(env, token, { method: 'POST' })).status, 403)
    }))
})

describe('signing key rotation', () => {
  test('a key rotated in without notice is picked up without a restart', (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.now() })
    return withEnv(async (env) => {
      const before = await env.idp.accessToken({ scope: READ_WRITE })
      assert.equal((await call(env, before)).status, 200)

      // The IdP replaces its key; the old one leaves the JWKS.
      await env.idp.rotateKey('ES256')
      t.mock.timers.tick(90_000)
      const after = await env.idp.accessToken({ scope: READ_WRITE })
      const reply = await call(env, after)
      assert.equal(reply.status, 200, 'a token signed with the new key must be accepted')
    })
  })
})
