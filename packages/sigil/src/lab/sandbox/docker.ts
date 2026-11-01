import { createHash } from 'node:crypto'
import type { AgentDriver } from '../agents/types.js'
import type { FsChange } from '../canary.js'
import type { ExecResult } from '../exec.js'
import { untag } from '../proxy/host.js'
import { type ProxyRecord, parseProxyLog, proxySource } from '../proxy/program.js'
import { hashTreeScript, parseShaSums, type Tree } from '../tree.js'
import {
  docker,
  dockerOk,
  imageExists,
  imageId,
  parseDockerDiff,
  repoDigest,
} from './docker-cli.js'
import type {
  Phase,
  PreparedImage,
  Sandbox,
  SandboxExecOptions,
  SandboxFactory,
  SandboxFacts,
} from './types.js'

export const AGENT_USER = 'dev'
export const AGENT_UID = 10001
export const AGENT_HOME = '/home/dev'
export const AGENT_WORK = '/home/dev/project'
const PROXY_PORT = 3128
const PROXY_ALIAS = 'egress'
const PROXY_POLICY = '/tmp/egress-policy.json'
const NOBODY = '65534:65534'
export const LAB_LABEL = 'dev.sigil.lab'
/**
 * The egress proxy sidecar, pinned by digest (multi-arch OCI index of node:24-bookworm, 2026-10-28).
 * Bump deliberately; the digest is recorded with every run.
 */
export const PROXY_IMAGE =
  'node:24-bookworm@sha256:e7add2a490bb17d97b485b8641bd88455fff7839ade0f5eba493c3508124d413'

export interface DockerLimits {
  cpus: number
  memory: string
  pids: number
}

export interface DockerFactoryOptions {
  /** Image for the egress proxy sidecar. Needs Node 22.3+ (process.getBuiltinModule). */
  proxyImage?: string
  limits?: Partial<DockerLimits>
  /** Label value grouping every container and network of one prove session, for cleanup. */
  session: string
  log?: (line: string) => void
}

const DEFAULT_LIMITS: DockerLimits = { cpus: 2, memory: '4g', pids: 1024 }

/**
 * The lab image: the task image plus a non-root `dev` user and the agent. Generated, not checked
 * in, so the published CLI needs no build context; the hash of this text is the image tag.
 */
export function labDockerfile(base: string, layers: readonly string[]): string {
  return [
    `FROM ${base}`,
    'USER root',
    // Debian/Ubuntu (useradd) or Alpine/busybox (adduser). 755 so root-run chown can traverse it.
    `RUN set -eu; if ! id -u ${AGENT_USER} >/dev/null 2>&1; then useradd --create-home --uid ${AGENT_UID} --shell /bin/bash ${AGENT_USER} 2>/dev/null || adduser -D -u ${AGENT_UID} -s /bin/sh ${AGENT_USER}; fi; mkdir -p ${AGENT_WORK}; chown -R ${AGENT_USER}:${AGENT_USER} ${AGENT_HOME}; chmod 755 ${AGENT_HOME}`,
    ...layers,
    `USER ${AGENT_USER}`,
    `ENV HOME=${AGENT_HOME}`,
    `WORKDIR ${AGENT_WORK}`,
    '',
  ].join('\n')
}

export function labImageTag(dockerfile: string): string {
  return `sigil-lab:${createHash('sha256').update(dockerfile).digest('hex').slice(0, 16)}`
}

export class DockerSandboxFactory implements SandboxFactory {
  readonly runner = 'docker' as const
  private readonly limits: DockerLimits
  private readonly proxyImage: string
  private seq = 0

  constructor(private readonly opts: DockerFactoryOptions) {
    this.limits = { ...DEFAULT_LIMITS, ...opts.limits }
    this.proxyImage = opts.proxyImage ?? PROXY_IMAGE
  }

  async prepare(
    taskImage: string,
    driver: AgentDriver,
    agentVersion: string | undefined,
  ): Promise<PreparedImage> {
    const log = this.opts.log ?? (() => {})
    for (const ref of new Set([taskImage, this.proxyImage])) {
      if (!(await imageExists(ref))) {
        log(`pulling ${ref}`)
        await dockerOk(['pull', ref], { timeoutMs: 20 * 60_000 })
      }
    }
    // Build FROM the digest, not the tag: a re-pushed tag must produce a different lab image.
    const pinned = await pinImage(taskImage)
    if (!pinned.includes('@sha256:'))
      log(`warning: ${taskImage} has no registry digest; the lab image is not pinned`)
    const layers = agentVersion ? driver.dockerLayers(agentVersion) : []
    const dockerfile = labDockerfile(pinned, layers)
    const tag = labImageTag(dockerfile)
    if (!(await imageExists(tag))) {
      log(
        `building ${tag} (${taskImage}${agentVersion ? ` + ${driver.label} ${agentVersion}` : ''})`,
      )
      await dockerOk(['build', '--label', `${LAB_LABEL}=image`, '-t', tag, '-'], {
        stdin: dockerfile,
        timeoutMs: 30 * 60_000,
      })
    }
    const prepared: PreparedImage = { ref: tag, base: taskImage }
    const id = await imageId(tag)
    if (id) prepared.id = id
    if (pinned.includes('@sha256:')) prepared.baseDigest = pinned
    return prepared
  }

  async agentVersion(image: PreparedImage, driver: AgentDriver): Promise<string | undefined> {
    const [bin, ...args] = driver.versionArgv()
    const r = await docker(
      ['run', '--rm', '--network', 'none', '--entrypoint', bin!, image.ref, ...args],
      {
        timeoutMs: 120_000,
      },
    )
    return r.code === 0 ? driver.parseVersion(r.stdout) : undefined
  }

  async create(image: PreparedImage, name: string): Promise<Sandbox> {
    this.seq += 1
    const id = `sigil-${name
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .slice(0, 40)}-${this.seq}-${process.pid}`
    const label = `${LAB_LABEL}=${this.opts.session}`
    const net = `${id}-net`
    const proxy = `${id}-egress`
    const agent = `${id}-agent`
    const sandbox = new DockerSandbox(agent, proxy, net, image)
    try {
      // The agent's only network: no gateway, no route out. The proxy is its only neighbour.
      await dockerOk(['network', 'create', '--internal', '--label', label, net])
      await dockerOk([
        'run',
        '-d',
        '--name',
        proxy,
        '--label',
        label,
        '--user',
        NOBODY,
        '--cap-drop',
        'ALL',
        '--security-opt',
        'no-new-privileges',
        '--memory',
        '256m',
        '--cpus',
        '0.5',
        '--pids-limit',
        '128',
        '--network',
        'bridge',
        '--entrypoint',
        'node',
        this.proxyImage,
        '-e',
        proxySource({ bind: '0.0.0.0', port: PROXY_PORT, allowFile: PROXY_POLICY }),
      ])
      await dockerOk(['network', 'connect', '--alias', PROXY_ALIAS, net, proxy])
      await sandbox.waitForProxy((r) => r.some((x) => x.event === 'ready'), 'start')
      const url = `http://${PROXY_ALIAS}:${PROXY_PORT}`
      const proxyEnv = ['HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy'].flatMap((k) => [
        '-e',
        `${k}=${url}`,
      ])
      await dockerOk([
        'run',
        '-d',
        '--name',
        agent,
        '--label',
        label,
        '--network',
        net,
        '--hostname',
        'sandbox',
        '--user',
        AGENT_USER,
        '--workdir',
        AGENT_WORK,
        // Root inside the container is used only by the lab (chown after docker cp). The agent runs
        // as dev with no-new-privileges, so these capabilities are unreachable to it.
        '--cap-drop',
        'ALL',
        '--cap-add',
        'CHOWN',
        '--cap-add',
        'DAC_OVERRIDE',
        '--cap-add',
        'FOWNER',
        '--security-opt',
        'no-new-privileges',
        '--memory',
        this.limits.memory,
        '--memory-swap',
        this.limits.memory,
        '--cpus',
        String(this.limits.cpus),
        '--pids-limit',
        String(this.limits.pids),
        ...proxyEnv,
        // npm's update check would be a denied (and logged) request in every run.
        '-e',
        'npm_config_update_notifier=false',
        '-e',
        'NO_PROXY=localhost,127.0.0.1',
        '-e',
        'no_proxy=localhost,127.0.0.1',
        '--entrypoint',
        '/bin/sh',
        image.ref,
        '-c',
        'trap "exit 0" TERM INT; while :; do sleep 3600 & wait $!; done',
      ])
    } catch (e) {
      await sandbox.dispose()
      throw e
    }
    return sandbox
  }
}

export class DockerSandbox implements Sandbox {
  readonly runner = 'docker' as const
  readonly workDir = AGENT_WORK
  readonly homeDir = AGENT_HOME
  readonly scratchDirs = ['/tmp', '/var/tmp', '/dev/shm', '/run/user']
  private diff0 = new Map<string, 'A' | 'C' | 'D'>()
  private hash0: Tree = new Map()
  private generation = 0

  constructor(
    readonly container: string,
    readonly proxy: string,
    readonly network: string,
    readonly image: PreparedImage,
  ) {}

  sh(script: string, opts: SandboxExecOptions = {}): Promise<ExecResult> {
    return this.exec(['/bin/sh', '-c', script], opts)
  }

  exec(argv: readonly string[], opts: SandboxExecOptions = {}): Promise<ExecResult> {
    return this.execAs(AGENT_USER, argv, opts)
  }

  private execAs(
    user: string,
    argv: readonly string[],
    opts: SandboxExecOptions = {},
  ): Promise<ExecResult> {
    const args = ['exec', '-i', '-u', user, '-w', opts.cwd ?? AGENT_WORK]
    for (const [k, v] of Object.entries(opts.env ?? {})) args.push('-e', `${k}=${v}`)
    // `-e NAME` without a value: docker reads it from its own environment, so it never hits argv.
    for (const k of Object.keys(opts.secretEnv ?? {})) args.push('-e', k)
    args.push(this.container)
    if (opts.timeoutMs) {
      // Killing the docker CLI does not stop the process inside the container; `timeout` does.
      args.push('timeout', '-s', 'TERM', '-k', '10', String(Math.ceil(opts.timeoutMs / 1000)))
    }
    args.push(...argv)
    return docker(args, {
      ...(opts.secretEnv ? { secretEnv: opts.secretEnv } : {}),
      ...(opts.stdin !== undefined ? { stdin: opts.stdin } : {}),
      ...(opts.onStdout ? { onStdout: opts.onStdout } : {}),
      // Backstop only; the in-container timeout above is what normally fires.
      ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs + 30_000 } : {}),
    }).then((r) => (r.code === 124 ? { ...r, timedOut: true } : r))
  }

  async copyIn(hostDir: string, dest: string): Promise<void> {
    await this.execAs(AGENT_USER, ['mkdir', '-p', dest])
    await dockerOk(['cp', `${hostDir}/.`, `${this.container}:${dest}`], { timeoutMs: 10 * 60_000 })
    const r = await this.execAs('0', ['chown', '-R', `${AGENT_USER}:${AGENT_USER}`, dest])
    if (r.code !== 0)
      throw new Error(`could not hand ${dest} to the agent user: ${r.stderr.trim()}`)
  }

  async writeFiles(
    files: readonly { path: string; content: string | Buffer; mode?: number }[],
  ): Promise<void> {
    for (const f of files) {
      const mode = (f.mode ?? 0o644).toString(8)
      // rm first: never write through a symlink the agent may have planted.
      const script = `umask 077; mkdir -p "$(dirname "$1")" && rm -f "$1" && cat > "$1" && chmod ${mode} "$1"`
      const r = await this.execAs(AGENT_USER, ['sh', '-c', script, 'sh', f.path], {
        stdin: f.content,
      })
      if (r.code !== 0)
        throw new Error(`could not write ${f.path} in the sandbox: ${r.stderr.trim()}`)
    }
  }

  async readFiles(
    paths: readonly string[],
  ): Promise<Map<string, { content: Buffer; mode: number }>> {
    if (paths.length === 0) return new Map()
    // base64 keeps binary content intact through the docker CLI's text stdout.
    const script = [
      'while IFS= read -r f; do',
      '  if [ -f "$f" ] && [ ! -L "$f" ]; then',
      '    printf "==SIGIL-FILE %s %s\\n" "$(stat -c %a "$f" 2>/dev/null || echo 644)" "$f"',
      '    base64 < "$f"',
      '  fi',
      'done',
    ].join('\n')
    const r = await this.execAs(AGENT_USER, ['sh', '-c', script], {
      stdin: `${paths.join('\n')}\n`,
      timeoutMs: 300_000,
    })
    return parseFileDump(r.stdout)
  }

  async hashTree(dir: string): Promise<Tree> {
    const r = await this.sh(hashTreeScript(dir), { timeoutMs: 300_000 })
    return parseShaSums(r.stdout, dir)
  }

  private async outsideDiff(): Promise<Map<string, 'A' | 'C' | 'D'>> {
    const r = await dockerOk(['diff', this.container], { timeoutMs: 120_000 })
    const all = parseDockerDiff(r.stdout)
    for (const p of [...all.keys()]) {
      if (p === AGENT_WORK || p.startsWith(`${AGENT_WORK}/`)) all.delete(p)
    }
    return all
  }

  private async hashPaths(paths: readonly string[]): Promise<Tree> {
    if (paths.length === 0) return new Map()
    const r = await this.execAs(
      AGENT_USER,
      ['sh', '-c', 'xargs -0 -r sha256sum 2>/dev/null; true'],
      {
        stdin: `${paths.join('\0')}\0`,
        timeoutMs: 300_000,
      },
    )
    return parseShaSums(r.stdout, '/')
  }

  async markOutside(): Promise<void> {
    this.diff0 = await this.outsideDiff()
    const present = [...this.diff0].filter(([, k]) => k !== 'D').map(([p]) => p)
    this.hash0 = withSlash(await this.hashPaths(present))
  }

  async outsideChanges(): Promise<FsChange[]> {
    const diff1 = await this.outsideDiff()
    const both = [...diff1]
      .filter(([p, k]) => k !== 'D' && this.diff0.has(p) && this.diff0.get(p) !== 'D')
      .map(([p]) => p)
    const hash1 = withSlash(await this.hashPaths(both))
    const changes: FsChange[] = []
    for (const [path, kind] of diff1) {
      const before = this.diff0.get(path)
      if (before === undefined) {
        changes.push({
          path,
          change: kind === 'D' ? 'deleted' : kind === 'A' ? 'added' : 'modified',
        })
      } else if (kind === 'D' && before !== 'D') {
        changes.push({ path, change: 'deleted' })
      } else if (kind !== 'D' && this.hash0.get(path) !== hash1.get(path)) {
        changes.push({ path, change: 'modified' })
      }
    }
    // A directory shows as changed whenever something inside it changes; report the leaves.
    return changes.filter((c) => !changes.some((o) => o.path.startsWith(`${c.path}/`)))
  }

  async setEgress(phase: Phase, allow: readonly string[]): Promise<void> {
    this.generation += 1
    const tag = `${phase}#${this.generation}`
    await dockerOk(
      [
        'exec',
        '-i',
        '-u',
        NOBODY,
        this.proxy,
        'sh',
        '-c',
        `cat > ${PROXY_POLICY}.tmp && mv ${PROXY_POLICY}.tmp ${PROXY_POLICY}`,
      ],
      { stdin: JSON.stringify({ phase: tag, allow }) },
    )
    await dockerOk(['kill', '--signal', 'HUP', this.proxy])
    await this.waitForProxy(
      (r) => r.some((x) => x.event === 'phase' && x.phase === tag),
      `switch to ${phase}`,
    )
  }

  async egressLog(): Promise<ProxyRecord[]> {
    const r = await docker(['logs', this.proxy], { timeoutMs: 60_000 })
    return parseProxyLog(r.stdout).map(untag)
  }

  async waitForProxy(test: (r: ProxyRecord[]) => boolean, what: string): Promise<void> {
    const deadline = Date.now() + 20_000
    while (Date.now() < deadline) {
      const r = await docker(['logs', this.proxy], { timeoutMs: 15_000 })
      if (test(parseProxyLog(r.stdout))) return
      await new Promise((res) => setTimeout(res, 150))
    }
    throw new Error(`the egress proxy did not ${what} in time`)
  }

  /** Kills every process of the agent user (Linux spares PID 1), e.g. servers left in the background. */
  async stopStrays(): Promise<void> {
    await this.execAs(AGENT_USER, ['sh', '-c', 'kill -KILL -1 2>/dev/null; true'], {
      timeoutMs: 30_000,
    })
  }

  async facts(): Promise<SandboxFacts> {
    const r = await dockerOk(['inspect', '--format', '{{json .}}', this.container])
    const info = JSON.parse(r.stdout) as {
      Mounts?: { Source?: string; Destination?: string }[]
      Config?: { User?: string }
      HostConfig?: { NetworkMode?: string; NanoCpus?: number; Memory?: number; PidsLimit?: number }
      Image?: string
    }
    const facts: SandboxFacts = {
      runner: 'docker',
      user: info.Config?.User ?? '',
      mounts: (info.Mounts ?? []).map((m) => `${m.Source ?? '?'} -> ${m.Destination ?? '?'}`),
      network: `${info.HostConfig?.NetworkMode ?? '?'} (internal) via ${PROXY_ALIAS}:${PROXY_PORT}`,
      image: this.image.ref,
      limits: {
        cpus: (info.HostConfig?.NanoCpus ?? 0) / 1e9,
        memoryBytes: info.HostConfig?.Memory ?? 0,
        pids: info.HostConfig?.PidsLimit ?? 0,
      },
    }
    if (info.Image) facts.imageId = info.Image
    return facts
  }

  async dispose(): Promise<void> {
    await docker(['rm', '-f', this.container, this.proxy], { timeoutMs: 60_000 }).catch(
      () => undefined,
    )
    await docker(['network', 'rm', this.network], { timeoutMs: 60_000 }).catch(() => undefined)
  }
}

/** `name:tag` → `name:tag@sha256:…` from the local image's registry digest; refs with a digest pass through. */
export async function pinImage(ref: string): Promise<string> {
  if (ref.includes('@sha256:')) return ref
  const digest = (await repoDigest(ref))?.split('@')[1]
  return digest ? `${ref}@${digest}` : ref
}

/** Parses the `==SIGIL-FILE <mode> <path>` + base64 dump written by readFiles. */
export function parseFileDump(output: string): Map<string, { content: Buffer; mode: number }> {
  const out = new Map<string, { content: Buffer; mode: number }>()
  let current: { path: string; mode: number; body: string[] } | undefined
  const flush = () => {
    if (current)
      out.set(current.path, {
        content: Buffer.from(current.body.join(''), 'base64'),
        mode: current.mode,
      })
  }
  for (const line of output.split('\n')) {
    const m = /^==SIGIL-FILE (\d+) (.+)$/.exec(line)
    if (m) {
      flush()
      current = { path: m[2]!, mode: Number.parseInt(m[1]!, 8), body: [] }
    } else if (current) {
      current.body.push(line.trim())
    }
  }
  flush()
  return out
}

/** Removes every container and network left by a session (Ctrl-C, crash). */
export async function cleanupSession(session: string): Promise<void> {
  const filter = `label=${LAB_LABEL}=${session}`
  const ps = await docker(['ps', '-aq', '--filter', filter], { timeoutMs: 60_000 })
  const ids = ps.stdout.split('\n').filter(Boolean)
  if (ids.length) await docker(['rm', '-f', ...ids], { timeoutMs: 120_000 })
  const nets = await docker(['network', 'ls', '-q', '--filter', filter], { timeoutMs: 60_000 })
  const netIds = nets.stdout.split('\n').filter(Boolean)
  if (netIds.length) await docker(['network', 'rm', ...netIds], { timeoutMs: 60_000 })
}

/** sha256sum prints absolute paths as given; parseShaSums with root '/' strips the slash. */
function withSlash(tree: Tree): Tree {
  return new Map([...tree].map(([p, h]) => [p.startsWith('/') ? p : `/${p}`, h]))
}
