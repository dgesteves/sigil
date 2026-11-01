import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import {
  assertExitedOnEof,
  assertOnlyProtocolOnStdout,
  connect,
  rawSession,
  textOf,
  typecheck,
} from './harness.mjs'

// Expected results come from data/notes.json (protected): 11 notes mention "mcp" in some casing.
const MCP_NEWEST_FIRST = [
  'n-114',
  'n-113',
  'n-112',
  'n-110',
  'n-109',
  'n-108',
  'n-107',
  'n-106',
  'n-104',
  'n-103',
  'n-101',
]

let client
before(async () => {
  client = await connect()
})
after(async () => {
  await client?.close()
})

async function search(args) {
  return client.callTool({ name: 'search_notes', arguments: args })
}

function ids(result) {
  assert.notEqual(result.isError, true, `unexpected tool error: ${textOf(result)}`)
  const notes = result.structuredContent?.notes
  assert.ok(
    Array.isArray(notes),
    `search_notes should return structuredContent { notes: [...] } like list_notes, got ${JSON.stringify(result).slice(0, 300)}`,
  )
  for (const n of notes) {
    for (const key of ['id', 'title', 'updatedAt']) {
      assert.equal(typeof n[key], 'string', `each result should carry "${key}" like list_notes`)
    }
  }
  return notes.map((n) => n.id)
}

test('search_notes is listed with a required query, an optional limit and a read-only annotation', async () => {
  const { tools } = await client.listTools()
  const tool = tools.find((t) => t.name === 'search_notes')
  assert.ok(tool, `search_notes not listed; tools: ${tools.map((t) => t.name).join(', ')}`)
  const props = tool.inputSchema.properties ?? {}
  assert.equal(props.query?.type, 'string', 'query should be a string parameter')
  assert.ok(['integer', 'number'].includes(props.limit?.type), 'limit should be a numeric parameter')
  assert.ok(tool.inputSchema.required?.includes('query'), 'query should be required')
  assert.ok(!(tool.inputSchema.required ?? []).includes('limit'), 'limit should be optional')
  assert.equal(tool.annotations?.readOnlyHint, true, 'tool annotations should mark it read-only')
  assert.ok(
    tools.some((t) => t.name === 'list_notes') && tools.some((t) => t.name === 'get_note'),
    'existing tools must keep working',
  )
})

test('matches title or body, ignoring case, newest first, 10 results by default', async () => {
  assert.deepEqual(ids(await search({ query: 'mcp' })), MCP_NEWEST_FIRST.slice(0, 10))
  assert.deepEqual(ids(await search({ query: 'MCP', limit: 50 })), MCP_NEWEST_FIRST)
  assert.deepEqual(ids(await search({ query: 'Zebra' })), ['n-111'])
})

test('limit caps the number of results', async () => {
  assert.deepEqual(ids(await search({ query: 'mCp', limit: 3 })), MCP_NEWEST_FIRST.slice(0, 3))
  assert.deepEqual(ids(await search({ query: 'mcp', limit: 1 })), ['n-114'])
})

test('blank queries and out-of-range limits come back as tool errors', async () => {
  for (const args of [
    { query: '' },
    { query: '   ' },
    { query: 'mcp', limit: 0 },
    { query: 'mcp', limit: 51 },
  ]) {
    const result = await search(args)
    assert.equal(result.isError, true, `expected isError for ${JSON.stringify(args)}`)
    assert.ok(textOf(result).length > 0, 'the error should carry a readable message')
  }
  // The server is still healthy afterwards.
  assert.deepEqual(ids(await search({ query: 'zebra' })), ['n-111'])
})

test('existing tools still behave the same', async () => {
  const listed = await client.callTool({ name: 'list_notes', arguments: { tag: 'mcp' } })
  assert.deepEqual(
    listed.structuredContent.notes.map((n) => n.id),
    ['n-113', 'n-112', 'n-108', 'n-106', 'n-103', 'n-101'],
  )
  const missing = await client.callTool({ name: 'get_note', arguments: { id: 'n-999' } })
  assert.equal(missing.isError, true)
})

test('stdout carries only MCP messages and the server exits when stdin closes', async () => {
  const { stdout, responses, exit } = await rawSession([
    { method: 'tools/list' },
    { method: 'tools/call', params: { name: 'search_notes', arguments: { query: 'zebra' } } },
    { method: 'tools/call', params: { name: 'search_notes', arguments: { query: ' ' } } },
  ])
  assert.ok(responses[1].result, 'tools/call should succeed')
  assertOnlyProtocolOnStdout(stdout)
  assertExitedOnEof(exit)
})

test('the project still type-checks', () => {
  const { ok, output } = typecheck()
  assert.ok(ok, `npm run typecheck fails:\n${output.slice(0, 2000)}`)
})
