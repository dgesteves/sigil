import express from 'express'
import { type Principal, requireAuth, requireScope } from './auth.ts'
import type { AuthConfig } from './config.ts'
import { ShipmentStore } from './shipments.ts'

export function createApp(auth: AuthConfig, shipments = new ShipmentStore()) {
  const app = express()
  app.disable('x-powered-by')
  app.use(express.json({ limit: '16kb' }))

  const authenticate = requireAuth(auth)

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' })
  })

  app.get('/v1/shipments', authenticate, requireScope('shipments:read'), (_req, res) => {
    const principal = res.locals.principal as Principal
    res.json({ shipments: shipments.listFor(principal.sub) })
  })

  app.post('/v1/shipments', authenticate, requireScope('shipments:write'), (req, res) => {
    const principal = res.locals.principal as Principal
    const destination = typeof req.body?.destination === 'string' ? req.body.destination.trim() : ''
    if (!destination) {
      res.status(400).json({ error: 'destination is required' })
      return
    }
    res.status(201).json(shipments.create(principal.sub, destination))
  })

  return app
}
