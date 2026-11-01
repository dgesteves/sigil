import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, describe, test } from 'node:test'
import {
  assertExitedOnEof,
  assertOnlyProtocolOnStdout,
  connect,
  rawSession,
  textOf,
  typecheck,
} from './harness.mjs'

// Behaviour recorded from the v1 server (src/ before the port) running on @modelcontextprotocol/sdk 1.32.2.
const SEARCH = {
  deploy: [
    'deployment: Deployment - Deployment',
    'troubleshooting: Troubleshooting - Nothing arrives after a deploy: confirm the endpoint printed by `relay deploy` m',
    'configuration: Configuration - Changes take effect on the next deploy. Secrets never go in `relay.toml`; use en',
    'getting-started: Getting started - Every event is signed. Verify the signature before you trust the payload, then d',
  ].join('\n'),
  Signature: [
    'getting-started: Getting started - Every event is signed. Verify the signature before you trust the payload, then d',
    'troubleshooting: Troubleshooting - Deliveries failing with 401: the handler is rejecting the signature. Check that ',
  ].join('\n'),
  relayLimit2: [
    'configuration: Configuration - Relay reads `relay.toml` from the project root.',
    'deployment: Deployment - Deploy Relay next to the services it forwards to.',
  ].join('\n'),
}
const PAGES = [
  ['configuration', 'Configuration'],
  ['deployment', 'Deployment'],
  ['getting-started', 'Getting started'],
  ['troubleshooting', 'Troubleshooting'],
]

const ERAS = [
  ['a 2025-era client (initialize handshake)', {}],
  [
    'a 2026-07-28 client (server/discover, no fallback)',
    { versionNegotiation: { mode: { pin: '2026-07-28' } } },
  ],
]

for (const [label, options] of ERAS) {
  describe(`served to ${label}`, () => {
    let client
    before(async () => {
      client = await connect(options)
    })
    after(async () => {
      await client?.close()
    })

    test('lists the same tools with the same parameters', async () => {
      const { tools } = await client.listTools()
      assert.deepEqual(tools.map((t) => t.name).sort(), ['index_stats', 'search_docs'])
      const search = tools.find((t) => t.name === 'search_docs')
      assert.deepEqual(search.inputSchema.required, ['query'])
      assert.ok(search.inputSchema.properties?.limit, 'search_docs keeps its optional limit')
      const stats = tools.find((t) => t.name === 'index_stats')
      assert.ok(stats.outputSchema?.properties?.pages && stats.outputSchema?.properties?.words)
    })

    test('search_docs answers exactly as before', async () => {
      const call = (args) => client.callTool({ name: 'search_docs', arguments: args })
      assert.equal(textOf(await call({ query: 'deploy' })), SEARCH.deploy)
      assert.equal(textOf(await call({ query: 'Signature' })), SEARCH.Signature)
      assert.equal(textOf(await call({ query: 'relay', limit: 2 })), SEARCH.relayLimit2)
      const none = await call({ query: 'zzz' })
      assert.notEqual(none.isError, true)
      assert.equal(textOf(none), 'No docs match "zzz".')
      assert.equal((await call({ query: '' })).isError, true, 'an empty query is a tool error')
    })

    test('index_stats returns structured counts and reports progress', async () => {
      client.wire.length = 0
      // onprogress makes the client send a progressToken; progress is then counted on the wire.
      const result = await client.callTool({ name: 'index_stats', arguments: {} }, { onprogress: () => {} })
      assert.notEqual(result.isError, true, `index_stats failed: ${textOf(result)}`)
      assert.deepEqual(result.structuredContent, { pages: 4, words: 258 })
      const progress = client.wire
        .filter((m) => m.method === 'notifications/progress')
        .map((m) => m.params)
      assert.ok(progress.length >= 2, `expected per-page progress notifications, got ${progress.length}`)
      assert.ok(
        progress.every((p, i) => p.total === 4 && (i === 0 || p.progress > progress[i - 1].progress)),
        `progress should count up towards a total of 4 pages: ${JSON.stringify(progress)}`,
      )
      assert.equal(progress.at(-1).progress, 4, 'the last progress update should be 4 of 4')
    })

    test('every page is listed and readable as Markdown', async () => {
      const { resources } = await client.listResources()
      const listed = resources
        .map((r) => [r.uri, r.name, r.mimeType])
        .sort((a, b) => a[0].localeCompare(b[0]))
      assert.deepEqual(
        listed,
        PAGES.map(([slug, title]) => [`docs://${slug}`, title, 'text/markdown']),
      )
      for (const [slug] of PAGES) {
        const { contents } = await client.readResource({ uri: `docs://${slug}` })
        assert.equal(contents[0]?.mimeType, 'text/markdown')
        assert.equal(contents[0]?.text, readFileSync(`docs/${slug}.md`, 'utf8'))
      }
    })

    test('unknown pages are errors, not empty results', async () => {
      await assert.rejects(client.readResource({ uri: 'docs://nope' }), (err) => err.code !== -32601)
      await assert.rejects(
        client.getPrompt({ name: 'summarize_doc', arguments: { slug: 'nope' } }),
        (err) => err.code !== -32601,
      )
    })

    test('summarize_doc builds the same prompt', async () => {
      const { messages } = await client.getPrompt({
        name: 'summarize_doc',
        arguments: { slug: 'configuration' },
      })
      assert.equal(messages.length, 1)
      assert.equal(messages[0].role, 'user')
      assert.equal(
        messages[0].content.text,
        `Summarise this page for a customer in three bullet points.\n\n${readFileSync('docs/configuration.md', 'utf8')}`,
      )
    })
  })
}

test('progress counts up per page, stdout carries only MCP messages, and the server exits on EOF', async () => {
  const { stdout, responses, exit } = await rawSession([
    { method: 'tools/call', params: { name: 'index_stats', arguments: {}, _meta: { progressToken: 'p1' } } },
    { method: 'tools/call', params: { name: 'search_docs', arguments: { query: 'deploy' } } },
  ])
  assert.ok(responses[0].result && !responses[0].result.isError, 'index_stats should succeed')
  const progress = stdout
    .split('\n')
    .filter((line) => line.includes('notifications/progress'))
    .map((line) => JSON.parse(line).params)
    .filter((p) => p.progressToken === 'p1')
  assert.ok(progress.length >= 2, `expected per-page progress notifications, got ${progress.length}`)
  assert.ok(
    progress.every((p, i) => p.total === 4 && (i === 0 || p.progress > progress[i - 1].progress)),
    `progress should count up towards a total of 4 pages: ${JSON.stringify(progress)}`,
  )
  assert.equal(progress.at(-1).progress, 4, 'the last progress update should be 4 of 4')
  assertOnlyProtocolOnStdout(stdout)
  assertExitedOnEof(exit)
})

test('the project type-checks', () => {
  const { ok, output } = typecheck()
  assert.ok(ok, `npm run typecheck fails:\n${output.slice(0, 2000)}`)
})
