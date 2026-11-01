import { randomBytes } from 'node:crypto'
import { Router } from 'express'
import * as client from 'openid-client'
import type { Config } from './config.ts'
import { readCookie, SESSION_COOKIE, setCookie } from './cookies.ts'
import type { OidcConfig } from './oidc.ts'
import type { SessionStore } from './session-store.ts'

const LOGIN_COOKIE = 'login_attempt'
const LOGIN_TTL_MS = 10 * 60 * 1000
const SESSION_TTL_MS = 12 * 60 * 60 * 1000

interface PendingLogin {
  codeVerifier: string
  state: string
  nonce: string
  expiresAt: number
}

/** Sign-in (authorization code + PKCE), callback and RP-initiated logout. */
export function authRoutes(config: Config, oidc: OidcConfig, sessions: SessionStore): Router {
  const router = Router()
  const pending = new Map<string, PendingLogin>()

  router.get('/login', async (_req, res) => {
    const attempt = randomBytes(32).toString('base64url')
    const login: PendingLogin = {
      codeVerifier: client.randomPKCECodeVerifier(),
      state: client.randomState(),
      nonce: client.randomNonce(),
      expiresAt: Date.now() + LOGIN_TTL_MS,
    }
    pending.set(attempt, login)
    setCookie(res, LOGIN_COOKIE, attempt, LOGIN_TTL_MS)
    const url = client.buildAuthorizationUrl(await oidc(), {
      redirect_uri: config.oidc.redirectUri,
      scope: 'openid email profile offline_access',
      code_challenge: await client.calculatePKCECodeChallenge(login.codeVerifier),
      code_challenge_method: 'S256',
      state: login.state,
      nonce: login.nonce,
    })
    res.redirect(url.href)
  })

  router.get('/auth/callback', async (req, res) => {
    const attempt = readCookie(req, LOGIN_COOKIE) ?? ''
    const login = pending.get(attempt)
    pending.delete(attempt)
    res.clearCookie(LOGIN_COOKIE, { path: '/' })
    if (!login || login.expiresAt < Date.now()) {
      res.status(400).send('This sign-in link has expired. Please sign in again.')
      return
    }
    const currentUrl = new URL(config.oidc.redirectUri)
    currentUrl.search = new URL(req.originalUrl, currentUrl).search
    try {
      const tokens = await client.authorizationCodeGrant(await oidc(), currentUrl, {
        pkceCodeVerifier: login.codeVerifier,
        expectedState: login.state,
        expectedNonce: login.nonce,
      })
      const claims = tokens.claims()
      if (!claims || !tokens.refresh_token) throw new Error('the IdP did not return the expected tokens')
      const sid = randomBytes(32).toString('base64url')
      await sessions.set(sid, {
        user: {
          sub: claims.sub,
          email: typeof claims.email === 'string' ? claims.email : undefined,
          name: typeof claims.name === 'string' ? claims.name : undefined,
        },
        tokens: {
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          idToken: tokens.id_token,
          expiresAt: Date.now() + (tokens.expiresIn() ?? 300) * 1000,
        },
        createdAt: Date.now(),
      })
      setCookie(res, SESSION_COOKIE, sid, SESSION_TTL_MS)
      res.redirect('/')
    } catch (err) {
      console.warn('sign-in failed:', err instanceof Error ? err.message : err)
      res.status(400).send('Sign-in failed. Please try again.')
    }
  })

  router.post('/logout', async (req, res) => {
    const sid = readCookie(req, SESSION_COOKIE)
    const session = sid ? await sessions.get(sid) : undefined
    if (sid) await sessions.delete(sid)
    res.clearCookie(SESSION_COOKIE, { path: '/' })
    const params: Record<string, string> = {
      post_logout_redirect_uri: config.oidc.postLogoutRedirectUri,
    }
    if (session?.tokens.idToken) params.id_token_hint = session.tokens.idToken
    res.redirect(client.buildEndSessionUrl(await oidc(), params).href)
  })

  return router
}
