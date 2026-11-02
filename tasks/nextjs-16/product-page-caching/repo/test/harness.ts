// Starts the production server (`next start`) for integration tests. Run `next build` first.
import { type ChildProcess, spawn } from 'node:child_process'

export type Server = { url: string; stop(): Promise<void>; output(): string }

export async function startServer(env: Record<string, string> = {}): Promise<Server> {
  const port = 4100 + Math.floor(Math.random() * 1800)
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
  for (let i = 0; i < 150; i++) {
    if (child.exitCode !== null) break
    try {
      await fetch(url, { redirect: 'manual' })
      return { url, stop, output: () => log }
    } catch {
      await new Promise((r) => setTimeout(r, 100))
    }
  }
  await stop()
  throw new Error(`next start did not come up. Did you run \`next build\`?\n${log}`)
}

const entities: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#x27;': "'", '&#39;': "'" }
export const decode = (s: string) => s.replace(/&(amp|lt|gt|quot|#x27|#39);/g, (m) => entities[m]!)

/** Text of every element carrying data-testid="<id>", in document order (streamed content comes last). */
export function byTestId(html: string, id: string): string[] {
  const re = new RegExp(`<([a-z0-9]+)\\b[^>]*\\bdata-testid="${id}"[^>]*>([\\s\\S]*?)</\\1>`, 'g')
  return [...html.matchAll(re)].map((m) =>
    decode(m[2]!.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, '')).trim(),
  )
}

export const lastTestId = (html: string, id: string) => byTestId(html, id).at(-1)
