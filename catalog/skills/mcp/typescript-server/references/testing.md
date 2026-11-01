# Testing an MCP server end to end

Unit-testing handlers is not enough: most MCP bugs live in registration (schemas, required fields,
output validation), the transport (stdout pollution, eras) and error mapping. Spawn the real server
and talk to it the way a host does. These snippets use `node:test`, the v2 client and Node 24's
built-in TypeScript support (`node src/server.ts`); adapt the command if you build to `dist/`.

## Client-based tests

```ts
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'

const ERAS = [
  ['2025 initialize', {}],
  ['2026-07-28', { versionNegotiation: { mode: { pin: '2026-07-28' } } }],
] as const

for (const [era, options] of ERAS) {
  describe(`over stdio, ${era}`, () => {
    let client: Client
    before(async () => {
      client = new Client({ name: 'tests', version: '1.0.0' }, options)
      await client.connect(
        new StdioClientTransport({ command: process.execPath, args: ['src/server.ts'], stderr: 'inherit' }),
      )
    })
    after(() => client.close())

    test('advertises the tool with the right parameters', async () => {
      const { tools } = await client.listTools()
      const tool = tools.find((t) => t.name === 'get_order')
      assert.ok(tool)
      assert.deepEqual(tool.inputSchema.required, ['id'])
      assert.equal(tool.annotations?.readOnlyHint, true)
    })

    test('returns structured output', async () => {
      const result = await client.callTool({ name: 'get_order', arguments: { id: 'o-1' } })
      assert.notEqual(result.isError, true)
      assert.deepEqual(result.structuredContent, { id: 'o-1', status: 'open', totalCents: 1200 })
    })

    test('domain failures are tool errors, not crashes', async () => {
      const result = await client.callTool({ name: 'get_order', arguments: { id: 'nope' } })
      assert.equal(result.isError, true)
    })

    test('unknown resources reject', async () => {
      await assert.rejects(client.readResource({ uri: 'orders://nope' }))
    })
  })
}
```

Drop the 2026-07-28 entry only if no host you support speaks it. Use `stderr: 'inherit'` while
debugging, `'pipe'` (and drain it) in CI.

## Raw stdout check

The v2 client skips lines on stdout that are not JSON, so the tests above pass even when the server
prints `console.log` banners. Other hosts do not forgive that. Check the bytes yourself:

```ts
import { spawn } from 'node:child_process'

async function rawStdout(requests: object[]): Promise<{ stdout: string; exited: boolean }> {
  const child = spawn(process.execPath, ['src/server.ts'], { stdio: ['pipe', 'pipe', 'inherit'] })
  let stdout = ''
  child.stdout.setEncoding('utf8').on('data', (d) => (stdout += d))
  const send = (m: object) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...m })}\n`)
  const answered = (id: number) =>
    stdout.split('\n').some((line) => {
      try {
        return JSON.parse(line).id === id
      } catch {
        return false
      }
    })
  const waitFor = async (id: number) => {
    for (let i = 0; i < 500 && !answered(id); i++) await new Promise((r) => setTimeout(r, 10))
  }
  send({ id: 0, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'raw', version: '1' } } })
  await waitFor(0)
  send({ method: 'notifications/initialized' })
  for (const [i, r] of requests.entries()) {
    send({ id: i + 1, ...r })
    await waitFor(i + 1)
  }
  const exit = new Promise<boolean>((resolve) => child.once('exit', () => resolve(true)))
  child.stdin.end() // the spec's graceful shutdown signal
  const timer = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5000).unref())
  const exited = await Promise.race([exit, timer])
  if (!exited) child.kill('SIGKILL')
  return { stdout, exited }
}

test('stdout carries only JSON-RPC and the server exits on EOF', async () => {
  const { stdout, exited } = await rawStdout([
    { method: 'tools/list' },
    { method: 'tools/call', params: { name: 'get_order', arguments: { id: 'o-1' } } },
  ])
  for (const line of stdout.split('\n').filter((l) => l.trim())) {
    const message = JSON.parse(line) // throws on banners and console.log output
    assert.equal(message.jsonrpc, '2.0')
  }
  assert.ok(exited, 'server should exit when stdin closes')
})
```

Exercise the code paths that log (errors, slow paths), not just startup.

## Progress

Do not assert on the number of `onprogress` callbacks. With client 2.4.0 we measured 100 calls of a
tool that sends four progress notifications: all four were on the wire before the response every
time, in both eras, yet the client invoked `onprogress` anywhere from zero to four times. Count the
notifications at the transport instead:

```ts
const transport = new StdioClientTransport({ command: process.execPath, args: ['src/server.ts'] })
const client = new Client({ name: 'tests', version: '1.0.0' })
await client.connect(transport)

const wire: JSONRPCMessage[] = [] // import type { JSONRPCMessage } from '@modelcontextprotocol/client'
const deliver = transport.onmessage // installed by connect()
transport.onmessage = (message) => {
  wire.push(message)
  deliver?.(message)
}

// Passing onprogress is what makes the client attach a progressToken to the request.
await client.callTool({ name: 'reindex', arguments: {} }, { onprogress: () => {} })
const updates = wire.filter((m) => 'method' in m && m.method === 'notifications/progress')
assert.ok(updates.length >= 2)
```

The raw stdout helper above works too: count the `notifications/progress` lines that carry your
`progressToken`.

## Type checking

Run `tsc --noEmit` against the SDK's types as part of `npm test` or CI. Most v1-isms (`server.tool`,
`extra.sendNotification`, `McpError`, wrong handler arity) are compile errors in v2 long before they are
runtime errors. Node's type stripping does not type-check, so `node src/server.ts` running is not
evidence that the code is right.
