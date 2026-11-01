import express from 'express'
import { createOrdersRepo } from './orders-repo.mjs'

export function createApp({ repo = createOrdersRepo() } = {}) {
  const app = express()
  app.disable('x-powered-by')
  app.use(express.json({ limit: '10kb' }))

  app.get('/api/health', (req, res) => {
    res.json({ ok: true })
  })

  app.get('/api/orders', async (req, res) => {
    res.json({ orders: await repo.list() })
  })

  app.get('/api/orders/:id', async (req, res) => {
    const order = await repo.get(req.params.id)
    if (!order) {
      return res.status(404).json({ error: { code: 'not_found', message: 'Order not found' } })
    }
    res.json(order)
  })

  app.post('/api/orders', async (req, res) => {
    const { sku, quantity } = req.body
    const order = await repo.create({ sku, quantity })
    res.status(201).json(order)
  })

  app.post('/api/orders/:id/cancel', (req, res) => {
    repo.cancel(req.params.id).then((order) => {
      res.json(order)
    })
  })

  return app
}
