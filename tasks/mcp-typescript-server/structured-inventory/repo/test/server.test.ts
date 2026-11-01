import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'

let client: Client

before(async () => {
  client = new Client({ name: 'inventory-mcp-tests', version: '1.0.0' })
  await client.connect(
    new StdioClientTransport({ command: process.execPath, args: ['src/server.ts'], stderr: 'ignore' }),
  )
})

after(async () => {
  await client.close()
})

function text(result: Awaited<ReturnType<Client['callTool']>>): string {
  return result.content
    .map((c) => (c.type === 'text' ? c.text : ''))
    .join('\n')
}

test('list_items lists the whole catalogue', async () => {
  const result = await client.callTool({ name: 'list_items', arguments: {} })
  for (const sku of ['SKU-1001', 'SKU-1002', 'SKU-1003', 'SKU-1004', 'SKU-1005']) {
    assert.match(text(result), new RegExp(sku))
  }
})

test('get_item summarises price and stock for people reading the transcript', async () => {
  const result = await client.callTool({ name: 'get_item', arguments: { sku: 'SKU-1001' } })
  assert.match(text(result), /Travel mug/)
  assert.match(text(result), /13/)
})
