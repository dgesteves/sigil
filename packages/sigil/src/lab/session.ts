import { randomBytes } from 'node:crypto'
import { join, resolve } from 'node:path'
import { digestDir } from '../core/digest.js'
import { isDirectory } from '../core/load.js'
import type { AgentDriver } from './agents/types.js'
import type { Auth } from './auth.js'
import { run } from './exec.js'
import type { SuiteInput } from './prove.js'
import { cleanupSession, DockerSandboxFactory } from './sandbox/docker.js'
import { ensureDaemon } from './sandbox/docker-cli.js'
import { HostSandboxFactory, hostEnv } from './sandbox/host.js'
import type { SandboxFactory } from './sandbox/types.js'
import { findTasks, TaskError } from './task.js'

export interface Session {
  factory: SandboxFactory
  /** Removes anything the session left behind (containers, networks). Safe to call twice. */
  cleanup: () => Promise<void>
}

/**
 * Builds the sandbox factory for a command and wires cleanup to Ctrl-C, so an interrupted session
 * never leaves containers or networks running.
 */
export async function openSession(opts: {
  host: boolean
  auth: Auth
  keep?: boolean
  log: (line: string) => void
}): Promise<Session> {
  if (opts.host) {
    const factory = new HostSandboxFactory({
      auth: opts.auth.kind === 'keychain' ? 'keychain' : 'token',
      ...(opts.keep ? { keep: true } : {}),
    })
    return { factory, cleanup: async () => {} }
  }
  await ensureDaemon(opts.log)
  const session = randomBytes(6).toString('hex')
  const factory = new DockerSandboxFactory({ session, log: opts.log })
  let cleaned = false
  const cleanup = async () => {
    if (cleaned) return
    cleaned = true
    process.off('SIGINT', onSignal)
    process.off('SIGTERM', onSignal)
    await cleanupSession(session)
  }
  const onSignal = () => {
    opts.log('interrupted; removing sandbox containers')
    void cleanup().finally(() => process.exit(130))
  }
  process.on('SIGINT', onSignal)
  process.on('SIGTERM', onSignal)
  return { factory, cleanup }
}

/**
 * The Sigil repo that holds tasks/, catalog/, evidence/ and lab-runs/: the nearest ancestor with a
 * tasks/ directory, else the nearest with catalog/. Preferring tasks/ keeps a sibling directory that
 * happens to be called `catalog` (a worktree, say) from being taken for the repo.
 */
export async function findLabRoot(from: string): Promise<string | undefined> {
  const ancestors: string[] = []
  for (let dir = resolve(from); ; dir = resolve(dir, '..')) {
    ancestors.push(dir)
    if (resolve(dir, '..') === dir) break
  }
  for (const marker of ['tasks', 'catalog']) {
    for (const dir of ancestors) if (await isDirectory(join(dir, marker))) return dir
  }
  return undefined
}

/** Suites by name (under tasks/) or by path, each with its digest. */
export async function resolveSuites(
  names: readonly string[],
  cwd: string,
  root: string,
): Promise<SuiteInput[]> {
  const tasksRoot = join(root, 'tasks')
  const out: SuiteInput[] = []
  for (const name of names) {
    const asPath = resolve(cwd, name)
    const dir = (await isDirectory(asPath)) ? asPath : join(tasksRoot, name)
    if (!(await isDirectory(dir))) throw new TaskError(`no suite ${name} (looked in ${tasksRoot})`)
    const tasks = await findTasks(dir, tasksRoot)
    const suite = tasks[0]!.suite
    if (tasks.some((t) => t.suite !== suite))
      throw new TaskError(`${name} mixes tasks from several suites`)
    out.push({ suite, digest: (await digestDir(dir)).digest, tasks })
  }
  return out
}

/** The agent version installed on the host, used to pin the same version in the Docker image. */
export async function hostAgentVersion(driver: AgentDriver): Promise<string | undefined> {
  const [bin, ...args] = driver.versionArgv()
  try {
    const r = await run(bin!, args, { env: hostEnv({}), timeoutMs: 30_000 })
    return r.code === 0 ? driver.parseVersion(r.stdout) : undefined
  } catch {
    return undefined
  }
}
