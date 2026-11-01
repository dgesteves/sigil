import { createServer } from 'node:http'
import { loadConfig } from './config.ts'

const config = loadConfig()

const server = createServer((req, res) => {
  const origin = req.headers.origin
  if (origin && config.allowedOrigins.includes(origin)) {
    res.setHeader('access-control-allow-origin', origin)
    res.setHeader('vary', 'origin')
  }
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify({ ok: true }))
})

server.requestTimeout = config.requestTimeoutMs
server.listen(config.port, () => {
  if (config.logLevel === 'debug') console.debug('config', { ...config, databaseUrl: '<redacted>' })
  console.info(`billing-worker listening on :${config.port} (metrics ${config.enableMetrics ? 'on' : 'off'})`)
})
