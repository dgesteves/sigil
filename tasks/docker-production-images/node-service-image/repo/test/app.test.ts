import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { test } from 'node:test'
import { createApp, type AppState } from '../src/app.ts'
import { loadConfig } from '../src/config.ts'

async function withServer(state: AppState, fn: (base: string) => Promise<void>) {
  const server = createServer(createApp(state)).listen(0)
  await new Promise((r) => server.once('listening', r))
  const { port } = server.address() as AddressInfo
  try {
    await fn(`http://127.0.0.1:${port}`)
  } finally {
    server.close()
  }
}

test('healthz is ok until the server drains', async () => {
  const state: AppState = { draining: false, tallies: new Map() }
  await withServer(state, async (base) => {
    assert.equal((await fetch(`${base}/healthz`)).status, 200)
    state.draining = true
    assert.equal((await fetch(`${base}/healthz`)).status, 503)
  })
})

test('tallies count up', async () => {
  await withServer({ draining: false, tallies: new Map() }, async (base) => {
    await fetch(`${base}/v1/tallies/signups/increment`, { method: 'POST' })
    const r = await fetch(`${base}/v1/tallies/signups/increment?by=4`, { method: 'POST' })
    assert.deepEqual(await r.json(), { name: 'signups', count: 5 })
    assert.equal((await fetch(`${base}/v1/tallies/Bad_Name`)).status, 404)
  })
})

test('config defaults', () => {
  assert.equal(loadConfig({}).port, 8080)
  assert.throws(() => loadConfig({ PORT: 'http' }))
})
