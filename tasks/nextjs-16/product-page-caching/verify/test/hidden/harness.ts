import { type ChildProcess, spawn } from 'node:child_process'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'

export type Server = {
  url: string
  stop(): Promise<void>
  output(): string
  get(path: string, cookie?: string): Promise<{ status: number; html: string; headers: Headers }>
  submit(path: string, form: [string, string][], cookie?: string): Promise<Response>
}

export async function startServer(env: Record<string, string> = {}): Promise<Server> {
  const port = 6100 + Math.floor(Math.random() * 1800)
  const url = `http://127.0.0.1:${port}`
  const child: ChildProcess = spawn(
    process.execPath,
    ['node_modules/next/dist/bin/next', 'start', '-p', String(port), '-H', '127.0.0.1'],
    { env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1', ...env }, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  let log = ''
  child.stdout?.on('data', (d) => (log += d))
  child.stderr?.on('data', (d) => (log += d))
  const stop = async () => {
    if (child.exitCode !== null) return
    const exited = new Promise((resolve) => child.once('exit', resolve))
    child.kill('SIGTERM')
    await exited
  }
  const server: Server = {
    url,
    stop,
    output: () => log,
    async get(path, cookie) {
      const res = await fetch(url + path, { headers: cookie ? { cookie } : {}, redirect: 'manual' })
      return { status: res.status, html: await res.text(), headers: res.headers }
    },
    // A browser without JavaScript submitting a server-action form: multipart POST to the page.
    async submit(path, form, cookie) {
      const body = new FormData()
      for (const [k, v] of form) body.append(k, v)
      const headers: Record<string, string> = { origin: url }
      if (cookie) headers.cookie = cookie
      const res = await fetch(url + path, { method: 'POST', body, headers, redirect: 'manual' })
      await res.arrayBuffer()
      return res
    },
  }
  for (let i = 0; i < 150; i++) {
    if (child.exitCode !== null) break
    try {
      await fetch(url, { redirect: 'manual' })
      return server
    } catch {
      await new Promise((r) => setTimeout(r, 100))
    }
  }
  await stop()
  throw new Error(`next start did not come up:\n${log}`)
}

const entities: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#x27;': "'", '&#39;': "'" }
export const decode = (s: string) => s.replace(/&(amp|lt|gt|quot|#x27|#39);/g, (m) => entities[m]!)

export function byTestId(html: string, id: string): string[] {
  const re = new RegExp(`<([a-z0-9]+)\\b[^>]*\\bdata-testid="${id}"[^>]*>([\\s\\S]*?)</\\1>`, 'g')
  return [...html.matchAll(re)].map((m) =>
    decode(m[2]!.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, '')).trim(),
  )
}
export const lastTestId = (html: string, id: string) => byTestId(html, id).at(-1)

export type Form = { html: string; fields: [string, string][] }

/** Server-rendered forms with the fields a browser would submit (inputs, textareas, named buttons). */
export function forms(html: string): Form[] {
  return [...html.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/g)].map((m) => {
    const fields: [string, string][] = []
    for (const tag of m[1]!.matchAll(/<(input|button)\b([^>]*)>/g)) {
      const attrs = tag[2]!
      const name = /\bname="([^"]*)"/.exec(attrs)?.[1]
      if (!name) continue
      if (tag[1] === 'input' && /\btype="(checkbox|radio)"/.test(attrs) && !/\bchecked\b/.test(attrs)) continue
      fields.push([decode(name), decode(/\bvalue="([^"]*)"/.exec(attrs)?.[1] ?? '')])
    }
    for (const ta of m[1]!.matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/g)) {
      const name = /\bname="([^"]*)"/.exec(ta[1]!)?.[1]
      if (name) fields.push([decode(name), decode(ta[2]!)])
    }
    return { html: m[0], fields }
  })
}

export const setField = (fields: [string, string][], name: string, value: string): [string, string][] =>
  fields.map(([k, v]) => [k, k === name ? value : v])

export function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, 'utf8')) as T
}

/** Atomic write, so a request reading the file never sees it half-written. */
export function writeJson(file: string, value: unknown) {
  writeFileSync(`${file}.tmp`, `${JSON.stringify(value, null, 2)}\n`)
  renameSync(`${file}.tmp`, file)
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
