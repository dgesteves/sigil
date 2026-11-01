// Hidden verifier helpers: drive the server exactly the way an MCP host does, over stdio.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'

export const SERVER_ARGS = ['src/server.ts']

/**
 * Connects the official client. `options` is passed to `new Client`, e.g. versionNegotiation.
 * `client.wire` records every message the server sends, in arrival order, at the transport level:
 * the client's own `onprogress` callback count is not reliable (2.4.0 can deliver fewer callbacks than
 * notifications that arrived before the response), so progress is asserted on the wire instead.
 */
export async function connect(options = {}) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: SERVER_ARGS,
    stderr: 'pipe',
  })
  transport.stderr?.resume()
  const client = new Client({ name: 'hidden-verifier', version: '1.0.0' }, options)
  await client.connect(transport)
  const wire = []
  const deliver = transport.onmessage
  transport.onmessage = (message, extra) => {
    wire.push(message)
    deliver?.(message, extra)
  }
  client.wire = wire
  return client
}

/**
 * Speaks the 2025-11-25 stdio handshake by hand and records every byte the server writes to stdout,
 * so output that the SDK client would silently skip is still caught.
 */
export async function rawSession(requests, { timeoutMs = 10_000 } = {}) {
  const child = spawn(process.execPath, SERVER_ARGS, { stdio: ['pipe', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8').on('data', (d) => {
    stdout += d
  })
  child.stderr.setEncoding('utf8').on('data', (d) => {
    stderr += d
  })
  let exitStatus = null
  const exited = new Promise((resolve) =>
    child.on('exit', (code, signal) => {
      exitStatus = { code, signal }
      resolve(exitStatus)
    }),
  )
  const send = (message) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`)
  const responseTo = async (id) => {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      for (const line of stdout.split('\n')) {
        try {
          const message = JSON.parse(line)
          if (message && message.id === id && ('result' in message || 'error' in message))
            return message
        } catch {}
      }
      if (exitStatus) {
        assert.fail(
          `server exited (${JSON.stringify(exitStatus)}) before answering request ${id}. stderr:\n${stderr}`,
        )
      }
      await sleep(10)
    }
    child.kill('SIGKILL')
    assert.fail(`no response to request ${id} within ${timeoutMs} ms. stderr:\n${stderr}`)
  }

  send({
    id: 0,
    method: 'initialize',
    params: {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'raw-verifier', version: '1.0.0' },
    },
  })
  const initialized = await responseTo(0)
  assert.ok(initialized.result, `initialize failed: ${JSON.stringify(initialized)}`)
  send({ method: 'notifications/initialized' })
  const responses = []
  for (const [i, request] of requests.entries()) {
    send({ id: i + 1, ...request })
    responses.push(await responseTo(i + 1))
  }
  child.stdin.end()
  const exit = await Promise.race([exited, sleep(5_000, null, { ref: false })])
  if (exit === null) child.kill('SIGKILL')
  return { stdout, stderr, responses, exit }
}

/** The stdio binding: the server MUST NOT write anything to stdout that is not a valid MCP message. */
export function assertOnlyProtocolOnStdout(stdout) {
  for (const line of stdout.split('\n')) {
    if (line.trim() === '') continue
    let message
    try {
      message = JSON.parse(line)
    } catch {
      assert.fail(`server wrote non-JSON-RPC output to stdout: ${JSON.stringify(line.slice(0, 200))}`)
    }
    const isResponse = 'id' in message && ('result' in message || 'error' in message)
    const isNotification = typeof message.method === 'string'
    assert.ok(
      message.jsonrpc === '2.0' && (isResponse || isNotification),
      `server wrote a non-MCP message to stdout: ${line.slice(0, 200)}`,
    )
  }
}

export function assertExitedOnEof(exit) {
  assert.ok(exit !== null, 'server did not exit within 5 s after its stdin was closed')
}

export function textOf(result) {
  return (result.content ?? [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n')
}

/** Runs the project's own type check (the repo's tsconfig and its pinned TypeScript). */
export function typecheck() {
  const r = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', '.'], {
    encoding: 'utf8',
  })
  return { ok: r.status === 0, output: `${r.stdout}${r.stderr}` }
}
