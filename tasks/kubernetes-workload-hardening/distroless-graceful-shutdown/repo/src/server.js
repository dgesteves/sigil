import { createServer } from 'node:http'
import { setTimeout as sleep } from 'node:timers/promises'
import { account, balance, entries } from './ledger.js'

const port = Number(process.env.PORT ?? 8080)
// Exports are throttled per row so a large export does not starve the event loop or the database.
const rowDelayMs = Number(process.env.EXPORT_ROW_DELAY_MS ?? 15)

const json = (res, status, body) =>
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))

export const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  if (url.pathname === '/healthz') return res.writeHead(200).end('ok')
  if (url.pathname === '/readyz') return res.writeHead(200).end('ready')

  const m = url.pathname.match(/^\/accounts\/([\w-]+)\/(balance|export)$/)
  if (!m) return json(res, 404, { error: 'not found' })
  const acc = account(m[1])
  if (!acc) return json(res, 404, { error: 'unknown account' })

  if (m[2] === 'balance') return json(res, 200, { account: acc.id, currency: acc.currency, balanceCents: balance(acc.id) })

  const rows = Math.min(Number(url.searchParams.get('rows') ?? 3000), 100_000)
  res.writeHead(200, { 'content-type': 'text/csv' })
  res.write('id,amount_cents,booked_at\n')
  for (const e of entries(acc.id, rows)) {
    res.write(`${e.id},${e.amountCents},${e.bookedAt}\n`)
    await sleep(rowDelayMs)
  }
  res.end()
})

if (import.meta.main) {
  server.listen(port, () => console.log(`ledger-api listening on ${port}`))

  // Graceful shutdown: stop accepting connections, let in-flight requests finish, then exit.
  process.on('SIGTERM', () => {
    console.log('SIGTERM: closing listener')
    server.close(() => process.exit(0))
  })
}
