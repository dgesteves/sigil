import { spawn } from 'node:child_process'

export interface ExecOptions {
  cwd?: string
  /** The complete environment. Nothing is inherited unless the caller passes it in. */
  env?: Record<string, string>
  stdin?: string | Buffer
  timeoutMs?: number
  /** Output beyond this is dropped from the middle; the head and tail are kept. */
  maxBytes?: number
  /** Called with each stdout chunk, e.g. to stream a transcript to disk as it arrives. */
  onStdout?: (chunk: Buffer) => void
}

export interface ExecResult {
  code: number
  stdout: string
  stderr: string
  timedOut: boolean
  ms: number
}

const DEFAULT_MAX = 32 * 1024 * 1024

/** Runs a program without a shell. Never rejects for a non-zero exit; only for a missing binary. */
export function run(
  file: string,
  args: readonly string[],
  opts: ExecOptions = {},
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const child = spawn(file, args, {
      cwd: opts.cwd,
      env: opts.env ?? minimalEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const out = capped(opts.maxBytes ?? DEFAULT_MAX)
    const err = capped(opts.maxBytes ?? DEFAULT_MAX)
    let timedOut = false
    let timer: NodeJS.Timeout | undefined
    if (opts.timeoutMs) {
      timer = setTimeout(() => {
        timedOut = true
        child.kill('SIGTERM')
        setTimeout(() => child.kill('SIGKILL'), 5000).unref()
      }, opts.timeoutMs)
    }
    child.stdout.on('data', (c: Buffer) => {
      out.push(c)
      opts.onStdout?.(c)
    })
    child.stderr.on('data', (c: Buffer) => err.push(c))
    child.on('error', (e) => {
      if (timer) clearTimeout(timer)
      reject(e)
    })
    child.on('close', (code, signal) => {
      if (timer) clearTimeout(timer)
      resolve({
        code: code ?? (signal ? 128 + signalNumber(signal) : 1),
        stdout: out.text(),
        stderr: err.text(),
        timedOut,
        ms: Date.now() - started,
      })
    })
    child.stdin.on('error', () => {
      // The child may exit before reading stdin; that is its business.
    })
    child.stdin.end(opts.stdin ?? '')
  })
}

/** PATH and locale only. Commands that need more say so explicitly. */
export function minimalEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = { LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' }
  if (process.env.PATH) env.PATH = process.env.PATH
  return { ...env, ...extra }
}

function capped(max: number) {
  const head: Buffer[] = []
  let headBytes = 0
  let tailChunks: Buffer[] = []
  let tailBytes = 0
  let dropped = 0
  return {
    push(chunk: Buffer) {
      if (headBytes < max / 2) {
        head.push(chunk)
        headBytes += chunk.length
        return
      }
      tailChunks.push(chunk)
      tailBytes += chunk.length
      while (tailBytes > max / 2 && tailChunks.length > 1) {
        const first = tailChunks[0]!
        tailChunks = tailChunks.slice(1)
        tailBytes -= first.length
        dropped += first.length
      }
    },
    text() {
      const mid = dropped ? `\n… [${dropped} bytes dropped] …\n` : ''
      return `${Buffer.concat(head).toString('utf8')}${mid}${Buffer.concat(tailChunks).toString('utf8')}`
    },
  }
}

function signalNumber(signal: NodeJS.Signals): number {
  const table: Partial<Record<NodeJS.Signals, number>> = { SIGINT: 2, SIGKILL: 9, SIGTERM: 15 }
  return table[signal] ?? 1
}
