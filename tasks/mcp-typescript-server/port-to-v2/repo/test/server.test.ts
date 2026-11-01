import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'

let client: Client

before(async () => {
  client = new Client({ name: 'relay-docs-tests', version: '1.0.0' })
  await client.connect(
    new StdioClientTransport({ command: process.execPath, args: ['src/server.ts'], stderr: 'inherit' }),
  )
})

after(async () => {
  await client.close()
})

test('lists the docs tools', async () => {
  const { tools } = await client.listTools()
  assert.deepEqual(tools.map((t) => t.name).sort(), ['index_stats', 'search_docs'])
})

test('search_docs finds the deployment page first', async () => {
  const result = await client.callTool({ name: 'search_docs', arguments: { query: 'deploy' } })
  const [first] = result.content
  assert.equal(first?.type, 'text')
  assert.match(first.type === 'text' ? first.text : '', /^deployment: Deployment/)
})
