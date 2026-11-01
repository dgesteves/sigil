import express from 'express'
import { createOrdersRepo, OrderNotFoundError, OrderStateError } from './orders-repo.mjs'

class HttpError extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

function parseNewOrder(body) {
  const sku = body?.sku
  const quantity = body?.quantity
  const problems = []
  if (typeof sku !== 'string' || sku.trim() === '') problems.push('sku must be a non-empty string')
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100)
    problems.push('quantity must be an integer from 1 to 100')
  if (problems.length) throw new HttpError(400, 'validation_failed', problems.join('; '))
  return { sku, quantity }
}

function toHttpError(err) {
  if (err instanceof HttpError) return err
  if (err instanceof OrderNotFoundError) return new HttpError(404, 'not_found', 'Order not found')
  if (err instanceof OrderStateError) return new HttpError(409, 'conflict', err.message)
  // body-parser and other http-errors style errors carry a 4xx status and mark safe messages `expose`.
  const status = err?.status ?? err?.statusCode
  if (Number.isInteger(status) && status >= 400 && status < 500) {
    const codes = { 400: 'bad_request', 413: 'payload_too_large', 415: 'unsupported_media_type' }
    return new HttpError(status, codes[status] ?? 'bad_request', err.expose ? err.message : 'Bad request')
  }
  return new HttpError(500, 'internal_error', 'Something went wrong')
}

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
    if (!order) throw new HttpError(404, 'not_found', 'Order not found')
    res.json(order)
  })

  app.post('/api/orders', async (req, res) => {
    const order = await repo.create(parseNewOrder(req.body))
    res.status(201).json(order)
  })

  // Express 5 forwards a rejected promise from an async handler to the error middleware.
  app.post('/api/orders/:id/cancel', async (req, res) => {
    res.json(await repo.cancel(req.params.id))
  })

  app.use((req, res) => {
    res.status(404).json({ error: { code: 'not_found', message: 'Route not found' } })
  })

  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err)
    const httpError = toHttpError(err)
    if (httpError.status >= 500) console.error(err)
    res.status(httpError.status).json({ error: { code: httpError.code, message: httpError.message } })
  })

  return app
}
