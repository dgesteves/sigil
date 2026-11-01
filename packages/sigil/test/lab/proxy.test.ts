import { mkdtempSync } from 'node:fs'
import { createServer as createHttp, request } from 'node:http'
import { connect, createServer, type Server } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { type HostProxy, startHostProxy } from '../../src/lab/proxy/host.js'
import { parseProxyLog, proxySource } from '../../src/lab/proxy/program.js'

let proxy: HostProxy
let echo: Server
let web: ReturnType<typeof createHttp>
let echoPort = 0
let webPort = 0

const listen = (s: Server | ReturnType<typeof createHttp>) =>
  new Promise<number>((resolve) =>
    s.listen(0, '127.0.0.1', () => resolve((s.address() as { port: number }).port)),
  )

/** Sends a raw CONNECT and resolves with the proxy's first response chunk. */
function tunnel(target: string, then?: (s: ReturnType<typeof connect>) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const s = connect(proxy.port, '127.0.0.1', () =>
      s.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`),
    )
    let buf = ''
    s.on('data', (c) => {
      buf += c.toString()
      if (buf.includes('\r\n\r\n')) {
        if (then && buf.startsWith('HTTP/1.1 200')) then(s)
        else {
          s.destroy()
          resolve(buf)
        }
      }
      if (then && buf.includes('ECHO:')) {
        s.destroy()
        resolve(buf)
      }
    })
    s.on('error', reject)
  })
}

function get(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port: proxy.port, path: url, method: 'GET' },
      (res) => {
        let body = ''
        res.on('data', (c) => {
          body += c
        })
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }))
      },
    )
    req.on('error', reject)
    req.end()
  })
}

beforeAll(async () => {
  echo = createServer((s) => s.on('data', (c) => s.write(`ECHO:${c.toString()}`)))
  echoPort = await listen(echo)
  web = createHttp((_req, res) => res.end('hi'))
  webPort = await listen(web)
  proxy = await startHostProxy(mkdtempSync(join(tmpdir(), 'sigil-proxy-')))
  await proxy.setPolicy('agent', [`127.0.0.1:${echoPort}`, `127.0.0.1:${webPort}`])
})

afterAll(async () => {
  await proxy.stop()
  echo.close()
  web.close()
})

describe('egress proxy', () => {
  it('tunnels to an allowed host:port', async () => {
    const out = await tunnel(`127.0.0.1:${echoPort}`, (s) => s.write('ping'))
    expect(out).toContain('200 Connection Established')
    expect(out).toContain('ECHO:ping')
  })

  it('denies anything else with 403 and logs the attempt', async () => {
    expect(await tunnel('evil.example:443')).toMatch(/^HTTP\/1\.1 403/)
    expect(await tunnel('127.0.0.1:1')).toMatch(/^HTTP\/1\.1 403/)
    await vi.waitFor(() => {
      const denied = proxy.records().filter((r) => r.event === 'connect' && !r.allowed)
      expect(denied.map((r) => r.host)).toContain('evil.example')
      expect(denied.every((r) => r.phase === 'agent')).toBe(true)
    })
  })

  it('survives clients that reset the connection (a hostile agent cannot kill it)', async () => {
    for (let i = 0; i < 5; i++) {
      await new Promise<void>((resolve) => {
        const s = connect(proxy.port, '127.0.0.1', () => {
          s.write('CONNECT evil.example:443 HTTP/1.1\r\n\r\n')
          s.resetAndDestroy()
          resolve()
        })
        s.on('error', () => resolve())
      })
    }
    await new Promise((r) => setTimeout(r, 50))
    expect(await tunnel('evil.example:443')).toMatch(/^HTTP\/1\.1 403/)
  })

  it('proxies plain HTTP for allowed hosts and logs the path', async () => {
    expect(await get(`http://127.0.0.1:${webPort}/hello?x=1`)).toEqual({ status: 200, body: 'hi' })
    expect((await get('http://blocked.example/leak?k=v')).status).toBe(403)
    await vi.waitFor(() => {
      const leak = proxy.records().find((r) => r.event === 'http' && r.host === 'blocked.example')
      expect(leak?.path).toBe('/leak?k=v')
    })
  })

  it('switches policy on reload, failing closed', async () => {
    await proxy.setPolicy('verify', [])
    expect(await tunnel(`127.0.0.1:${echoPort}`)).toMatch(/^HTTP\/1\.1 403/)
    // The proxy logs asynchronously; slow CI runners can read the log before the line lands.
    await vi.waitFor(() => {
      const last = proxy
        .records()
        .filter((r) => r.event === 'connect')
        .at(-1)
      expect(last?.phase).toBe('verify')
    })
    await proxy.setPolicy('agent', [`127.0.0.1:${echoPort}`, `127.0.0.1:${webPort}`])
  })

  it('ships as a self-contained program and ignores junk in its log', () => {
    const src = proxySource({ bind: '0.0.0.0', port: 3128, allowFile: '/tmp/p.json' })
    expect(src).toContain('getBuiltinModule')
    expect(src).not.toMatch(/__vi_|require\(|import\(/)
    expect(parseProxyLog('garbage\n{"ts":1,"event":"ready","port":1}\n{"broken"\n')).toEqual([
      { ts: 1, event: 'ready', port: 1 },
    ])
  })
})
