import express from 'express'
import type { NextFunction, Request, Response } from 'express'
import { authRoutes } from './auth.ts'
import { BillingApi, IdpUnavailableError, NotAuthenticatedError, UpstreamError } from './billing-api.ts'
import type { Config } from './config.ts'
import { readCookie, SESSION_COOKIE } from './cookies.ts'
import { oidcConfig } from './oidc.ts'
import type { SessionStore } from './session-store.ts'

export interface AppDeps {
  config: Config
  sessions: SessionStore
}

export function createApp({ config, sessions }: AppDeps) {
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', 'loopback')

  const oidc = oidcConfig(config.oidc)
  const billing = new BillingApi({ baseUrl: config.billingApiUrl, sessions, oidc })

  const sessionId = (req: Request): string => {
    const sid = readCookie(req, SESSION_COOKIE)
    if (!sid) throw new NotAuthenticatedError('no session cookie')
    return sid
  }

  app.use(authRoutes(config, oidc, sessions))

  app.get('/api/dashboard', async (req, res) => {
    const sid = sessionId(req)
    const [account, invoices, usage] = await Promise.all([
      billing.get(sid, '/v1/account'),
      billing.get(sid, '/v1/invoices?limit=5'),
      billing.get(sid, '/v1/usage/current'),
    ])
    res.json({ account, invoices, usage })
  })

  app.get('/api/invoices', async (req, res) => {
    res.json(await billing.get(sessionId(req), '/v1/invoices'))
  })

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof NotAuthenticatedError) {
      res.status(401).json({ error: 'login_required' })
      return
    }
    console.error(err)
    if (err instanceof IdpUnavailableError) {
      res.status(503).json({ error: 'temporarily_unavailable' })
      return
    }
    if (err instanceof UpstreamError) {
      res.status(502).json({ error: 'billing_unavailable' })
      return
    }
    res.status(500).json({ error: 'internal_error' })
  })

  return app
}
