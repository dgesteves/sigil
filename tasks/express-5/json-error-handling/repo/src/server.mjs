import { createApp } from './app.mjs'

const port = Number(process.env.PORT ?? 3000)
const server = createApp().listen(port, (error) => {
  if (error) throw error
  console.log(`orders-api listening on ${JSON.stringify(server.address())}`)
})
