import express from 'express'
import { products } from './catalog.mjs'

export function createApp() {
  const app = express()
  app.disable('x-powered-by')
  app.use(express.json({ limit: '50kb' }))

  app.get('/api/health', (req, res) => {
    res.json({ ok: true })
  })

  app.get('/api/products', (req, res) => {
    res.json({ products })
  })

  app.use((req, res) => {
    res.status(404).json({ error: 'not_found' })
  })

  return app
}
