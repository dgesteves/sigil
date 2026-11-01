import { randomBytes } from 'node:crypto'
import { createApp } from '../../src/app.ts'
import type { Config } from '../../src/config.ts'
import { MemorySessionStore, type Session, type SessionStore } from '../../src/session-store.ts'
import { type BillingUpstream, startBillingUpstream } from './billing-upstream.ts'
import { listen } from './http.ts'
import { TestIdp, type TestUser } from './idp.ts'

export const CLIENT_ID = 'billing-dashboard'
export const PUBLIC_ORIGIN = 'https://billing.example.test'

export interface Env {
  idp: TestIdp
  upstream: BillingUpstream
  sessions: SessionStore
  url: string
  /** Creates a session as a completed sign-in would; `accessTokenTtl` in seconds may be negative. */
  signIn(user: TestUser, opts?: { accessTokenTtl?: number }): Promise<string>
  request(path: string, sid?: string, init?: RequestInit): Promise<Response>
  close(): Promise<void>
}

export async function startEnv(opts: { sessions?: SessionStore } = {}): Promise<Env> {
  const idp = await TestIdp.start({
    clients: [
      {
        clientId: CLIENT_ID,
        clientSecret: 'billing-client-secret-93ad',
        redirectUris: [`${PUBLIC_ORIGIN}/auth/callback`],
        postLogoutRedirectUris: [`${PUBLIC_ORIGIN}/`],
      },
    ],
  })
  const upstream = await startBillingUpstream(idp)
  const sessions = opts.sessions ?? new MemorySessionStore()
  const config: Config = {
    port: 0,
    oidc: {
      issuer: idp.issuer,
      clientId: CLIENT_ID,
      clientSecret: 'billing-client-secret-93ad',
      redirectUri: `${PUBLIC_ORIGIN}/auth/callback`,
      postLogoutRedirectUri: `${PUBLIC_ORIGIN}/`,
      allowHttpIssuer: true,
    },
    billingApiUrl: upstream.url,
  }
  const app = await listen(createApp({ config, sessions }))
  return {
    idp,
    upstream,
    sessions,
    url: app.url,
    async signIn(user, signInOpts = {}) {
      const ttl = signInOpts.accessTokenTtl ?? 300
      const tokens = await idp.issueTokens(CLIENT_ID, user, { accessTokenTtl: ttl })
      const sid = randomBytes(32).toString('base64url')
      const session: Session = {
        user: { sub: user.sub, email: user.email, name: user.name },
        tokens: {
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          idToken: tokens.id_token,
          expiresAt: Date.now() + ttl * 1000,
        },
        createdAt: Date.now(),
      }
      await sessions.set(sid, session)
      return sid
    },
    request(path, sid, init = {}) {
      const headers = new Headers(init.headers)
      if (sid) headers.set('cookie', `sid=${sid}`)
      return fetch(`${app.url}${path}`, { ...init, headers, redirect: 'manual' })
    },
    async close() {
      await app.close()
      await upstream.close()
      await idp.close()
    },
  }
}
