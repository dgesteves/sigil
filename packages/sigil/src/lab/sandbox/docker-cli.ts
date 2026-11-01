import { type ExecOptions, type ExecResult, run } from '../exec.js'

/**
 * The docker CLI, never an SDK: one dependency fewer, and every action the lab takes is a command an
 * operator can read and replay.
 */

/** Environment for the docker CLI: what it needs to find the daemon, plus per-call secrets. */
export function dockerEnv(secret: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {}
  for (const k of [
    'PATH',
    'HOME',
    'DOCKER_HOST',
    'DOCKER_CONTEXT',
    'DOCKER_CONFIG',
    'DOCKER_CERT_PATH',
    'DOCKER_TLS_VERIFY',
  ]) {
    const v = process.env[k]
    if (v) env[k] = v
  }
  return { ...env, ...secret }
}

export class DockerError extends Error {
  constructor(
    message: string,
    readonly result?: ExecResult,
  ) {
    super(message)
  }
}

export interface DockerCallOptions extends Omit<ExecOptions, 'env'> {
  /** Secret values exported to the docker CLI process only; argv carries just the names. */
  secretEnv?: Record<string, string>
}

export async function docker(
  args: readonly string[],
  opts: DockerCallOptions = {},
): Promise<ExecResult> {
  const { secretEnv, ...rest } = opts
  try {
    return await run('docker', args, { ...rest, env: dockerEnv(secretEnv) })
  } catch (e) {
    throw new DockerError(`could not run the docker CLI: ${(e as Error).message}`)
  }
}

/** Like docker(), but a non-zero exit is an error with the CLI's own message. */
export async function dockerOk(
  args: readonly string[],
  opts: DockerCallOptions = {},
): Promise<ExecResult> {
  const r = await docker(args, opts)
  if (r.code !== 0) {
    const msg = (r.stderr || r.stdout).trim().split('\n').slice(-3).join(' ')
    throw new DockerError(`docker ${args[0]} failed: ${msg}`, r)
  }
  return r
}

export async function daemonUp(): Promise<boolean> {
  try {
    const r = await docker(['info', '--format', '{{.ServerVersion}}'], { timeoutMs: 15_000 })
    return r.code === 0 && r.stdout.trim().length > 0
  } catch {
    return false
  }
}

/**
 * Makes sure a Docker daemon answers. On macOS a stopped Docker Desktop is started with
 * `open -a Docker` and given up to `waitMs` to come up.
 */
export async function ensureDaemon(
  log: (line: string) => void = () => {},
  waitMs = 180_000,
  sleep = (ms: number) => new Promise((r) => setTimeout(r, ms)),
): Promise<void> {
  if (await daemonUp()) return
  if (process.platform !== 'darwin') {
    throw new DockerError('the Docker daemon is not running; start it and retry')
  }
  log('Docker is not running; starting Docker Desktop')
  await run('open', ['-a', 'Docker'], { timeoutMs: 15_000 }).catch(() => undefined)
  const deadline = Date.now() + waitMs
  while (Date.now() < deadline) {
    await sleep(3000)
    if (await daemonUp()) return
  }
  throw new DockerError(`Docker Desktop did not come up within ${Math.round(waitMs / 1000)}s`)
}

export async function imageExists(ref: string): Promise<boolean> {
  const r = await docker(['image', 'inspect', '--format', '{{.Id}}', ref], { timeoutMs: 30_000 })
  return r.code === 0
}

export async function imageId(ref: string): Promise<string | undefined> {
  const r = await docker(['image', 'inspect', '--format', '{{.Id}}', ref], { timeoutMs: 30_000 })
  return r.code === 0 ? r.stdout.trim() : undefined
}

export async function repoDigest(ref: string): Promise<string | undefined> {
  const r = await docker(['image', 'inspect', '--format', '{{join .RepoDigests " "}}', ref], {
    timeoutMs: 30_000,
  })
  return r.code === 0 ? r.stdout.trim().split(' ').filter(Boolean)[0] : undefined
}

/** `docker diff` output → entries. Kinds: A added, C changed, D deleted. */
export function parseDockerDiff(output: string): Map<string, 'A' | 'C' | 'D'> {
  const out = new Map<string, 'A' | 'C' | 'D'>()
  for (const line of output.split('\n')) {
    const m = /^([ACD]) (\/.*)$/.exec(line.trim())
    if (m) out.set(m[2]!, m[1] as 'A' | 'C' | 'D')
  }
  return out
}
