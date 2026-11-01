import { createApp } from './app.ts'
import { loadConfig } from './config.ts'

const config = loadConfig()
createApp(config).listen(config.port, () => {
  console.log(`partner-portal listening on :${config.port}`)
})
