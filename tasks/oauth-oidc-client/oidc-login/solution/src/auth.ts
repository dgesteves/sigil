import { Router } from 'express'
import type { Request } from 'express'
import * as client from 'openid-client'
import type { Config } from './config.ts'
import { SESSION_COOKIE } from './session.ts'

const LOGIN_TIMEOUT_MS = 10 * 60 * 1000

const promisify =
  (fn: (cb: (err?: unknown) => void) => void) =>
  () =>
    new Promise<void>((resolve, reject) => fn((err) => (err ? reject(err) : resolve())))

/**
 * The URL the IdP redirected the browser to. Built from the registered redirect URI, not from the
 * request: behind the load balancer the request's own scheme and host are internal ones, and
 * openid-client sends this URL (minus its query) as redirect_uri in the token request.
 */
function callbackUrl(config: Config, req: Request): URL {
  const url = new URL(config.oidc.redirectUri)
  url.search = new URL(req.originalUrl, url).search
  return url
}

export function authRoutes(config: Config, getOidc: () => Promise<client.Configuration>): Router {
  const router = Router()

  router.get('/login', async (req, res) => {
    const oidc = await getOidc()
    const codeVerifier = client.randomPKCECodeVerifier()
    const state = client.randomState()
    const nonce = client.randomNonce()
    req.session.pendingLogin = { codeVerifier, state, nonce, startedAt: Date.now() }
    const url = client.buildAuthorizationUrl(oidc, {
      redirect_uri: config.oidc.redirectUri,
      scope: 'openid email profile',
      code_challenge: await client.calculatePKCECodeChallenge(codeVerifier),
      code_challenge_method: 'S256',
      state,
      nonce,
    })
    await promisify((cb) => req.session.save(cb))()
    res.redirect(url.href)
  })

  router.get('/auth/callback', async (req, res) => {
    // Single use: whatever happens next, this login attempt is consumed.
    const pending = req.session.pendingLogin
    delete req.session.pendingLogin
    if (!pending || Date.now() - pending.startedAt > LOGIN_TIMEOUT_MS) {
      res.status(400).send('This sign-in link has expired. Please sign in again.')
      return
    }

    let tokens: Awaited<ReturnType<typeof client.authorizationCodeGrant>>
    try {
      tokens = await client.authorizationCodeGrant(await getOidc(), callbackUrl(config, req), {
        pkceCodeVerifier: pending.codeVerifier,
        expectedState: pending.state,
        expectedNonce: pending.nonce,
        idTokenExpected: true,
      })
    } catch (err) {
      console.warn('sign-in failed:', err instanceof Error ? err.message : err)
      res.status(400).send('Sign-in failed. Please try again.')
      return
    }

    const claims = tokens.claims()
    if (!claims) {
      res.status(400).send('Sign-in failed. Please try again.')
      return
    }

    // A new session id after login, so a session id planted before login is worthless.
    await promisify((cb) => req.session.regenerate(cb))()
    req.session.user = {
      sub: claims.sub,
      email: typeof claims.email === 'string' ? claims.email : undefined,
      name: typeof claims.name === 'string' ? claims.name : undefined,
    }
    req.session.idToken = tokens.id_token
    await promisify((cb) => req.session.save(cb))()
    res.redirect('/')
  })

  router.post('/logout', async (req, res) => {
    const idToken = req.session.idToken
    await promisify((cb) => req.session.destroy(cb))()
    res.clearCookie(SESSION_COOKIE)
    const params: Record<string, string> = {
      post_logout_redirect_uri: config.oidc.postLogoutRedirectUri,
    }
    if (idToken) params.id_token_hint = idToken
    res.redirect(client.buildEndSessionUrl(await getOidc(), params).href)
  })

  return router
}
