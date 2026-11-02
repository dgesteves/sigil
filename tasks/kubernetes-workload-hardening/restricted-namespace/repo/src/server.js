import { createServer } from 'node:http'
import { renderLabel } from './labels.js'

const port = Number(process.env.PORT ?? 8080)
let ready = false

const server = createServer(async (req, res) => {
  if (req.url === '/healthz') return res.writeHead(200).end('ok')
  if (req.url === '/readyz') return res.writeHead(ready ? 200 : 503).end(ready ? 'ready' : 'starting')
  if (req.method === 'POST' && req.url === '/labels') {
    let body = ''
    for await (const chunk of req) body += chunk
    try {
      const pdf = await renderLabel(JSON.parse(body))
      return res.writeHead(201, { 'content-type': 'application/pdf' }).end(pdf)
    } catch (err) {
      return res.writeHead(400).end(String(err.message))
    }
  }
  res.writeHead(404).end()
})

server.listen(port, () => {
  ready = true
  console.log(`parcelhub api listening on ${port}`)
})

process.on('SIGTERM', () => server.close(() => process.exit(0)))
