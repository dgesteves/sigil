import { createSocket } from 'node:dgram'
import { createServer } from 'node:http'

const statsd = createSocket('udp4')
const metric = (line) => statsd.send(line, 9125, '127.0.0.1')

const server = createServer((req, res) => {
  const started = performance.now()
  const url = new URL(req.url, 'http://localhost')
  if (url.pathname === '/healthz') return res.writeHead(200).end('ok')
  if (url.pathname === '/search') {
    const q = url.searchParams.get('q') ?? ''
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ q, hits: [] }))
    return metric(`search.latency:${(performance.now() - started).toFixed(1)}|ms`)
  }
  res.writeHead(404).end()
})

server.listen(Number(process.env.PORT ?? 8080))
process.on('SIGTERM', () => server.close(() => process.exit(0)))
