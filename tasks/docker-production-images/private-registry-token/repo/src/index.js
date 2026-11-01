import { createServer } from 'node:http'
import pino from 'pino'
import { createHandler } from './app.js'

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' })
const port = Number(process.env.PORT ?? 8080)
const server = createServer(createHandler({ log, ledger: [] }))

server.listen(port, () => log.info({ port }, 'ledger-worker listening'))

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    log.info({ signal }, 'shutting down')
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(1), 10_000).unref()
  })
}
