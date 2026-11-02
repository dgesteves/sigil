// A stand-in for the billing API: it accepts only live access tokens from the test IdP and records
// which token every call carried.
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { TestIdp } from './idp.ts'

export interface UpstreamCall {
  path: string
  token: string
  accepted: boolean
}

export interface BillingUpstream {
  url: string
  calls: UpstreamCall[]
  close(): Promise<void>
}

export async function startBillingUpstream(idp: TestIdp): Promise<BillingUpstream> {
  const calls: UpstreamCall[] = []
  const server = createServer((req, res) => {
    const token = (req.headers.authorization ?? '').replace(/^Bearer /, '')
    const caller = idp.checkAccessToken(token)
    const path = req.url ?? '/'
    calls.push({ path, token, accepted: caller !== undefined })
    res.setHeader('content-type', 'application/json')
    if (!caller) {
      res.statusCode = 401
      res.setHeader('www-authenticate', 'Bearer error="invalid_token"')
      res.end(JSON.stringify({ error: 'invalid_token' }))
      return
    }
    const sub = caller.sub
    let body: unknown
    if (path.startsWith('/v1/account')) body = { sub, plan: 'business', currency: 'EUR' }
    else if (path.startsWith('/v1/invoices'))
      body = { owner: sub, invoices: [{ id: `inv-${sub}-1`, total: 129.0, status: 'paid' }] }
    else if (path.startsWith('/v1/usage')) body = { owner: sub, seats: 14, apiCalls: 182_331 }
    else {
      res.statusCode = 404
      body = { error: 'not_found' }
    }
    res.end(JSON.stringify(body))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    calls,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}
