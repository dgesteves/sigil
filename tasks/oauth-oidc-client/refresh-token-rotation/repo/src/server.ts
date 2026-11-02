import { createApp } from './app.ts'
import { loadConfig } from './config.ts'
import { MemorySessionStore } from './session-store.ts'

const config = loadConfig()
// Production wires the Redis store from @acme/session-redis here.
createApp({ config, sessions: new MemorySessionStore() }).listen(config.port, () => {
  console.log(`billing-dashboard listening on :${config.port}`)
})
