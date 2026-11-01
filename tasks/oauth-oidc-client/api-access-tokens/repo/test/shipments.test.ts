import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createApp } from '../src/app.ts'
import { TestIdp } from './support/idp.ts'
import { listen, type Running } from './support/http.ts'

const audience = 'https://shipments.api.acme.test'
let idp: TestIdp
let api: Running

before(async () => {
  idp = await TestIdp.start({ apiAudience: audience })
  api = await listen(createApp({ issuer: idp.issuer, audience }))
})

after(async () => {
  await api.close()
  await idp.close()
})

test('health needs no token', async () => {
  const res = await fetch(`${api.url}/health`)
  assert.equal(res.status, 200)
})

test('a caller sees the shipments they created', async () => {
  const token = await idp.accessToken({ sub: 'carrier-42', scope: 'shipments:read shipments:write' })
  const created = await fetch(`${api.url}/v1/shipments`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ destination: 'Rotterdam' }),
  })
  assert.equal(created.status, 201)
  const list = await fetch(`${api.url}/v1/shipments`, { headers: { authorization: `Bearer ${token}` } })
  assert.equal(list.status, 200)
  const body = (await list.json()) as { shipments: { destination: string }[] }
  assert.deepEqual(
    body.shipments.map((s) => s.destination),
    ['Rotterdam'],
  )
})

test('requests without a token are rejected', async () => {
  const res = await fetch(`${api.url}/v1/shipments`)
  assert.equal(res.status, 401)
})
