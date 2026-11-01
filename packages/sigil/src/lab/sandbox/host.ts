import {
  chmod,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { homedir, tmpdir, userInfo } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type { AgentDriver } from '../agents/types.js'
import type { FsChange } from '../canary.js'
import { type ExecResult, run } from '../exec.js'
import { type HostProxy, startHostProxy } from '../proxy/host.js'
import type { ProxyRecord } from '../proxy/program.js'
import { diffTrees, hashTree, type Tree } from '../tree.js'
import type {
  Phase,
  PreparedImage,
  Sandbox,
  SandboxExecOptions,
  SandboxFactory,
  SandboxFacts,
} from './types.js'

export type HostAuth = 'token' | 'keychain'

export interface HostFactoryOptions {
  /**
   * `keychain` (macOS, no token): the agent binary reads the operator's own login from the macOS
   * keychain. The keychain directory is linked into the isolated HOME; nothing else from the real
   * HOME is. Sigil itself never reads the keychain.
   */
  auth: HostAuth
  /** Keep the run directory after dispose, for debugging. */
  keep?: boolean
}

/**
 * Host runner: trusted, first-party capabilities only. A temp directory holds an isolated HOME, the
 * work dir and TMPDIR; the agent's own config, skills, plugins, CLAUDE.md and memory therefore come
 * from an empty HOME. There is no filesystem sandbox beyond what the agent provides itself, so
 * outside-write detection covers the isolated HOME and transcript paths only.
 */
export class HostSandboxFactory implements SandboxFactory {
  readonly runner = 'host' as const
  constructor(private readonly opts: HostFactoryOptions) {}

  async prepare(): Promise<PreparedImage> {
    return { ref: 'host', base: `${process.platform}-${process.arch}` }
  }

  async agentVersion(_image: PreparedImage, driver: AgentDriver): Promise<string | undefined> {
    const [bin, ...args] = driver.versionArgv()
    try {
      const r = await run(bin!, args, { env: hostEnv({}), timeoutMs: 30_000 })
      return driver.parseVersion(r.stdout)
    } catch {
      return undefined
    }
  }

  async create(_image: PreparedImage, name: string): Promise<Sandbox> {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), `sigil-${name.replace(/[^a-z0-9-]/gi, '-')}-`)),
    )
    const home = join(root, 'home')
    const work = join(root, 'project')
    const tmp = join(root, 'tmp')
    await Promise.all([mkdir(home), mkdir(work), mkdir(tmp)])
    if (this.opts.auth === 'keychain') {
      if (process.platform !== 'darwin')
        throw new Error('keychain auth exists only on macOS; pass a token')
      await mkdir(join(home, 'Library'), { recursive: true })
      await symlink(join(homedir(), 'Library', 'Keychains'), join(home, 'Library', 'Keychains'))
    }
    const proxy = await startHostProxy(root)
    return new HostSandbox(root, home, work, tmp, proxy, this.opts.keep ?? false)
  }
}

export class HostSandbox implements Sandbox {
  readonly runner = 'host' as const
  readonly scratchDirs: readonly string[]
  readonly operatorHome = homedir()
  private before: Tree | undefined

  constructor(
    readonly root: string,
    readonly homeDir: string,
    readonly workDir: string,
    private readonly tmp: string,
    private readonly proxy: HostProxy,
    private readonly keep: boolean,
  ) {
    this.scratchDirs = [tmp, '/tmp', '/private/tmp', '/var/folders']
  }

  private env(opts: SandboxExecOptions): Record<string, string> {
    const url = `http://127.0.0.1:${this.proxy.port}`
    return hostEnv({
      HOME: this.homeDir,
      TMPDIR: this.tmp,
      HTTPS_PROXY: url,
      HTTP_PROXY: url,
      https_proxy: url,
      http_proxy: url,
      npm_config_update_notifier: 'false',
      NO_PROXY: 'localhost,127.0.0.1',
      no_proxy: 'localhost,127.0.0.1',
      ...opts.env,
      ...opts.secretEnv,
    })
  }

  sh(script: string, opts: SandboxExecOptions = {}): Promise<ExecResult> {
    return this.exec(['/bin/sh', '-c', script], opts)
  }

  exec(argv: readonly string[], opts: SandboxExecOptions = {}): Promise<ExecResult> {
    const [file, ...args] = argv
    return run(file!, args, {
      cwd: opts.cwd ?? this.workDir,
      env: this.env(opts),
      ...(opts.stdin !== undefined ? { stdin: opts.stdin } : {}),
      ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}),
      ...(opts.onStdout ? { onStdout: opts.onStdout } : {}),
    }).catch((e: Error) => ({ code: 127, stdout: '', stderr: e.message, timedOut: false, ms: 0 }))
  }

  async copyIn(hostDir: string, dest: string): Promise<void> {
    this.assertInside(dest)
    await cp(hostDir, dest, { recursive: true, force: true, verbatimSymlinks: true })
  }

  async writeFiles(
    files: readonly { path: string; content: string | Buffer; mode?: number }[],
  ): Promise<void> {
    for (const f of files) {
      this.assertInside(f.path)
      await mkdir(dirname(f.path), { recursive: true })
      // Never write through a symlink the agent may have planted: it could point anywhere.
      await unlink(f.path).catch((e: NodeJS.ErrnoException) => {
        if (e.code !== 'ENOENT') throw e
      })
      await writeFile(f.path, f.content, { flag: 'wx' })
      if (f.mode !== undefined) await chmod(f.path, f.mode)
    }
  }

  async readFiles(
    paths: readonly string[],
  ): Promise<Map<string, { content: Buffer; mode: number }>> {
    const out = new Map<string, { content: Buffer; mode: number }>()
    for (const p of paths) {
      const st = await lstat(p).catch(() => undefined)
      if (st?.isFile()) out.set(p, { content: await readFile(p), mode: st.mode & 0o777 })
    }
    return out
  }

  hashTree(dir: string): Promise<Tree> {
    return hashTree(dir)
  }

  async markOutside(): Promise<void> {
    this.before = await hashTree(this.homeDir)
  }

  async outsideChanges(): Promise<FsChange[]> {
    if (!this.before) return []
    const after = await hashTree(this.homeDir)
    return diffTrees(this.before, after).map((c) => ({
      path: join(this.homeDir, c.path),
      change: c.change,
    }))
  }

  setEgress(phase: Phase, allow: readonly string[]): Promise<void> {
    return this.proxy.setPolicy(phase, allow)
  }

  async egressLog(): Promise<ProxyRecord[]> {
    return this.proxy.records()
  }

  async stopStrays(): Promise<void> {
    // Nothing safe to do on a host: there is no process boundary that holds only the agent's
    // processes. Background processes the agent starts can outlive it (documented limitation).
  }

  async facts(): Promise<SandboxFacts> {
    return {
      runner: 'host',
      user: userInfo().username,
      mounts: [],
      network: `host network; HTTP(S)_PROXY -> 127.0.0.1:${this.proxy.port} (advisory: programs that ignore proxy variables are not stopped)`,
    }
  }

  async dispose(): Promise<void> {
    await this.proxy.stop()
    if (!this.keep) await rm(this.root, { recursive: true, force: true })
  }

  private assertInside(path: string): void {
    const abs = resolve(path)
    if (!abs.startsWith(`${this.root}/`))
      throw new Error(`refusing to write outside the run directory: ${path}`)
  }
}

/** The host environment for agent processes: PATH and identity only, never the operator's env. */
export function hostEnv(extra: Record<string, string>): Record<string, string> {
  const user = userInfo().username
  return {
    PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
    USER: user,
    LOGNAME: user,
    SHELL: '/bin/sh',
    LANG: 'en_US.UTF-8',
    ...extra,
  }
}
