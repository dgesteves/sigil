import { createServer } from 'node:http'
import pino from 'pino'
import { createApp, type AppState } from './app.ts'
import { loadConfig } from './config.ts'

const config = loadConfig()
const log = pino({ level: config.logLevel })
const state: AppState = { draining: false, tallies: new Map() }
const server = createServer(createApp(state))

server.listen(config.port, () => log.info({ port: config.port }, 'tally-api listening'))

function shutdown(signal: NodeJS.Signals): void {
  if (state.draining) return
  state.draining = true
  log.info({ signal }, 'draining connections before exit')
  server.close((err) => {
    if (err) log.error({ err }, 'error while closing the server')
    log.info('shutdown complete')
    process.exit(err ? 1 : 0)
  })
  server.closeIdleConnections()
  setTimeout(() => {
    log.warn('shutdown timed out, exiting')
    process.exit(1)
  }, config.shutdownTimeoutMs).unref()
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
