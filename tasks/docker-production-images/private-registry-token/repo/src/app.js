import { formatCents } from '@northwind/money'
import { validateEntry } from './postings.js'

export function createHandler({ log, ledger }) {
  return async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost')
    if (req.method === 'GET' && url.pathname === '/healthz') {
      res.writeHead(200, { 'content-type': 'text/plain' })
      return res.end('ok')
    }
    if (req.method === 'POST' && url.pathname === '/v1/entries') {
      let body = ''
      for await (const chunk of req) body += chunk
      let entry
      try {
        entry = JSON.parse(body)
      } catch {
        res.writeHead(400, { 'content-type': 'application/json' })
        return res.end(JSON.stringify({ error: 'body must be JSON' }))
      }
      const problems = validateEntry(entry)
      if (problems.length) {
        res.writeHead(422, { 'content-type': 'application/json' })
        return res.end(JSON.stringify({ error: 'invalid entry', problems }))
      }
      const total = entry.postings.filter((p) => p.side === 'debit').reduce((s, p) => s + p.cents, 0)
      ledger.push(entry)
      log.info({ id: entry.id, total: formatCents(total, entry.currency ?? 'EUR') }, 'entry posted')
      res.writeHead(201, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ id: entry.id }))
    }
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'not found' }))
  }
}
