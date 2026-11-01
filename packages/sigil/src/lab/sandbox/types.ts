import type { AgentDriver } from '../agents/types.js'
import type { FsChange } from '../canary.js'
import type { ExecResult } from '../exec.js'
import type { ProxyRecord } from '../proxy/program.js'
import type { Tree } from '../tree.js'

export type Phase = 'setup' | 'agent' | 'verify'

export interface SandboxExecOptions {
  /** Directory inside the sandbox. Defaults to the work dir. */
  cwd?: string
  env?: Record<string, string>
  /** Values never appear in argv, logs or files. */
  secretEnv?: Record<string, string>
  stdin?: string | Buffer
  timeoutMs?: number
  onStdout?: (chunk: Buffer) => void
}

/** What a sandbox can tell about itself, recorded in the run manifest and checked by `sigil lab check`. */
export interface SandboxFacts {
  runner: 'docker' | 'host'
  user: string
  /** Host paths visible inside the sandbox. Docker: must be empty. */
  mounts: string[]
  network: string
  image?: string
  imageId?: string
  limits?: { cpus?: number; memoryBytes?: number; pids?: number }
}

export interface Sandbox {
  readonly runner: 'docker' | 'host'
  readonly workDir: string
  readonly homeDir: string
  /** Directories where any writes are expected (temp). */
  readonly scratchDirs: readonly string[]
  /** The operator's real home, for host runners only: the path the agent must be kept out of. */
  readonly operatorHome?: string
  /** Runs a POSIX shell script as the agent user. */
  sh(script: string, opts?: SandboxExecOptions): Promise<ExecResult>
  /** Runs a program as the agent user, without a shell. */
  exec(argv: readonly string[], opts?: SandboxExecOptions): Promise<ExecResult>
  /** Copies the contents of a host directory over a sandbox directory, owned by the agent user. */
  copyIn(hostDir: string, dest: string): Promise<void>
  writeFiles(
    files: readonly { path: string; content: string | Buffer; mode?: number }[],
  ): Promise<void>
  /** Reads regular files (never through a symlink). Missing or non-regular paths are left out. */
  readFiles(paths: readonly string[]): Promise<Map<string, { content: Buffer; mode: number }>>
  hashTree(dir: string): Promise<Tree>
  /** Starts the window in which writes outside the work dir are recorded. */
  markOutside(): Promise<void>
  outsideChanges(): Promise<FsChange[]>
  /** Switches the egress policy. Resolves once the proxy confirms the new policy. */
  setEgress(phase: Phase, allow: readonly string[]): Promise<void>
  egressLog(): Promise<ProxyRecord[]>
  /** Kills whatever the agent left running (background servers) before the verifier runs. */
  stopStrays(): Promise<void>
  facts(): Promise<SandboxFacts>
  dispose(): Promise<void>
}

export interface PreparedImage {
  /** Image tag the sandbox runs (Docker) or `host`. */
  ref: string
  /** Content id of the image, for the repro manifest. */
  id?: string
  /** The task image it was built from, with its registry digest when known. */
  base: string
  baseDigest?: string
}

export interface SandboxFactory {
  readonly runner: 'docker' | 'host'
  /** Builds or locates the image for a task image + agent version, once per prove session. */
  prepare(
    taskImage: string,
    driver: AgentDriver,
    agentVersion: string | undefined,
  ): Promise<PreparedImage>
  /** The agent's version as installed in the prepared image (or on the host). */
  agentVersion(image: PreparedImage, driver: AgentDriver): Promise<string | undefined>
  create(image: PreparedImage, name: string): Promise<Sandbox>
}
