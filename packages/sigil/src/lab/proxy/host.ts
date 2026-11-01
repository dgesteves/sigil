import { type ChildProcess, spawn } from 'node:child_process'
import { rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { minimalEnv } from '../exec.js'
import { type ProxyRecord, parseProxyLog, proxySource } from './program.js'

export interface HostProxy {
  port: number
  setPolicy(phase: string, allow: readonly string[]): Promise<void>
  records(): ProxyRecord[]
  stop(): Promise<void>
}

/** Starts the egress proxy as a child process bound to 127.0.0.1 on an ephemeral port. */
export async function startHostProxy(dir: string): Promise<HostProxy> {
  const allowFile = join(dir, 'egress-policy.json')
  await writeFile(allowFile, JSON.stringify({ phase: 'init', allow: [] }))
  const child: ChildProcess = spawn(
    process.execPath,
    ['-e', proxySource({ bind: '127.0.0.1', port: 0, allowFile })],
    {
      env: minimalEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  let output = ''
  const waiters: { test: (r: ProxyRecord[]) => boolean; done: () => void }[] = []
  child.stdout?.on('data', (c: Buffer) => {
    output += c.toString('utf8')
    const records = parseProxyLog(output)
    for (const w of [...waiters]) {
      if (w.test(records)) {
        waiters.splice(waiters.indexOf(w), 1)
        w.done()
      }
    }
  })
  child.stderr?.on('data', () => {
    // A crash shows up as a missing `ready` record; the stack is not useful to the operator.
  })
  const waitFor = (test: (r: ProxyRecord[]) => boolean, what: string) =>
    new Promise<void>((resolve, reject) => {
      if (test(parseProxyLog(output))) return resolve()
      const timer = setTimeout(
        () => reject(new Error(`egress proxy did not ${what} within 10s`)),
        10_000,
      )
      waiters.push({
        test,
        done: () => {
          clearTimeout(timer)
          resolve()
        },
      })
    })

  await waitFor((r) => r.some((x) => x.event === 'ready'), 'start')
  const ready = parseProxyLog(output).find((r) => r.event === 'ready')
  let generation = 0

  return {
    port: ready?.port ?? 0,
    async setPolicy(phase, allow) {
      generation += 1
      const tag = `${phase}#${generation}`
      const tmp = `${allowFile}.tmp`
      await writeFile(tmp, JSON.stringify({ phase: tag, allow }))
      await rename(tmp, allowFile)
      child.kill('SIGHUP')
      await waitFor(
        (r) => r.some((x) => x.event === 'phase' && x.phase === tag),
        `switch to ${phase}`,
      )
    },
    records: () => parseProxyLog(output).map(untag),
    async stop() {
      if (child.exitCode !== null) return
      await new Promise<void>((resolve) => {
        child.once('close', () => resolve())
        child.kill('SIGTERM')
      })
    },
  }
}

/**
 * Phases are tagged `<phase>#<n>` so a reload can be confirmed even when the phase name repeats;
 * consumers only care about the phase.
 */
export function untag(r: ProxyRecord): ProxyRecord {
  return r.phase ? { ...r, phase: r.phase.replace(/#\d+$/, '') } : r
}
