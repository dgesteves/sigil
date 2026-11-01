import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'

let client: Client

before(async () => {
  client = new Client({ name: 'notes-mcp-tests', version: '1.0.0' })
  await client.connect(
    new StdioClientTransport({ command: process.execPath, args: ['src/server.ts'], stderr: 'ignore' }),
  )
})

after(async () => {
  await client.close()
})

test('list_notes returns every note, newest first', async () => {
  const result = await client.callTool({ name: 'list_notes', arguments: {} })
  assert.equal(result.isError, undefined)
  const { notes } = result.structuredContent as { notes: { id: string }[] }
  assert.equal(notes.length, 14)
  assert.equal(notes[0]?.id, 'n-114')
  assert.equal(notes.at(-1)?.id, 'n-101')
})

test('list_notes filters by tag', async () => {
  const result = await client.callTool({ name: 'list_notes', arguments: { tag: 'mcp' } })
  const { notes } = result.structuredContent as { notes: { id: string }[] }
  assert.deepEqual(
    notes.map((n) => n.id),
    ['n-113', 'n-112', 'n-108', 'n-106', 'n-103', 'n-101'],
  )
})

test('get_note returns the body, and a readable error for unknown ids', async () => {
  const found = await client.callTool({ name: 'get_note', arguments: { id: 'n-111' } })
  assert.match(JSON.stringify(found.content), /zebra crossing/)
  const missing = await client.callTool({ name: 'get_note', arguments: { id: 'n-999' } })
  assert.equal(missing.isError, true)
})
