import express from 'express'
import { authRoutes } from './auth.ts'
import type { Config } from './config.ts'
import { oidcConfiguration } from './oidc.ts'
import { sessions } from './session.ts'

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

export function createApp(config: Config) {
  const app = express()
  app.disable('x-powered-by')
  // TLS ends at the load balancer in front of us, on the same host.
  app.set('trust proxy', 'loopback')
  app.use(sessions(config))

  const getOidc = oidcConfiguration(config.oidc)

  app.get('/', (req, res) => {
    const user = req.session.user
    res.type('html').send(
      user
        ? `<p>Signed in as ${escapeHtml(user.name ?? user.sub)}</p><form method="post" action="/logout"><button>Sign out</button></form>`
        : '<a href="/login">Sign in</a>',
    )
  })

  app.get('/me', (req, res) => {
    if (!req.session.user) {
      res.status(401).json({ error: 'not_signed_in' })
      return
    }
    res.json(req.session.user)
  })

  app.use(authRoutes(config, getOidc))

  return app
}
