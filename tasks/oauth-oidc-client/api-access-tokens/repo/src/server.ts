import { createApp } from './app.ts'
import { loadConfig } from './config.ts'

const config = loadConfig()
createApp(config.auth).listen(config.port, () => {
  console.log(`shipments-api listening on :${config.port}`)
})
