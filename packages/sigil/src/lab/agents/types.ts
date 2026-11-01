import type { AgentId } from '../../core/ids.js'
import type { LabCapability } from '../capability.js'

/** One stdout line with its arrival time in ms since the agent started. */
export interface StampedLine {
  t: number
  line: string
}

/**
 * An agent event before truncation and redaction. Detectors (canaries, false-done) read the full
 * text; only the trace writer shortens and scrubs it.
 */
export interface RawEvent {
  t: number
  kind: 'assistant' | 'tool-call' | 'tool-result' | 'system'
  tool?: string
  text: string
  /** Structured tool input, so detectors can look at a path field rather than free text. */
  input?: Record<string, unknown>
  ok?: boolean
}

/** What the agent itself reports about its configuration; used to verify isolation empirically. */
export interface AgentEnvironment {
  cwd?: string
  tools: string[]
  skills: string[]
  agents: string[]
  plugins: { name: string; path: string }[]
  mcpServers: string[]
  memoryPaths: string[]
}

export interface AgentOutcome {
  events: RawEvent[]
  finalMessage: string
  tokens: number
  costUsd?: number
  /** Model as reported by the agent, never the alias that was requested. */
  model?: string
  version?: string
  /** The agent ended on an error of its own (auth, API, crash) rather than finishing the task. */
  error?: string
  environment?: AgentEnvironment
}

export interface InvocationSpec {
  prompt: string
  model: string
  workDir: string
  homeDir: string
  runner: 'docker' | 'host'
  /** Host runner only: the operator's real home, which the agent must be kept out of. */
  operatorHome?: string
  /** Long-lived auth token. Passed as an environment variable, never as an argument or a file. */
  token?: string
  maxBudgetUsd?: number
}

export interface Invocation {
  argv: string[]
  /** Non-secret environment, merged over the sandbox's base environment. */
  env: Record<string, string>
  /** Secret environment: never logged, never in argv, never written to disk. */
  secretEnv: Record<string, string>
  stdin?: string
}

export interface InstallFile {
  /** POSIX path relative to the work dir. */
  path: string
  content: Buffer
}

export interface IsolationContext {
  condition: 'baseline' | 'treatment'
  homeDir: string
  workDir: string
  /** Names the treatment is expected to add (e.g. the skill name). */
  installed: string[]
}

/**
 * An agent the lab can run. Adding Codex, Gemini CLI, OpenCode, Cursor or Copilot means adding one
 * of these; nothing else in the lab knows which agent it is driving.
 */
export interface AgentDriver {
  readonly id: AgentId
  readonly label: string
  /** Hosts the agent needs while it works. Everything else is denied and logged. */
  readonly egress: readonly string[]
  /**
   * Hosts the agent's own harness contacts that the lab denies on purpose (e.g. account-level
   * connectors that would leak the operator's setup). Denials here are expected, logged, and not
   * canary events, because the baseline makes them too.
   */
  readonly harnessDenied: readonly string[]
  /** HOME-relative globs the agent writes as its own state; not outside-writes. */
  readonly stateGlobs: readonly string[]
  /** HOME-relative globs that, if written, would change future agent sessions: persistence. */
  readonly persistenceGlobs: readonly string[]
  /** Dockerfile instructions that install this agent version on top of a task image. */
  dockerLayers(version: string): string[]
  versionArgv(): string[]
  parseVersion(stdout: string): string | undefined
  /** Files that install the capability for the treatment condition. */
  installFiles(capability: LabCapability): Promise<InstallFile[]>
  /** What the treatment is expected to add to the agent's reported environment. */
  installedNames(capability: LabCapability): string[]
  invocation(spec: InvocationSpec): Invocation
  parse(lines: readonly StampedLine[], stderr: string): AgentOutcome
  /** Problems with isolation, judged from what the agent reported. Empty = isolated. */
  isolationProblems(outcome: AgentOutcome, ctx: IsolationContext): string[]
}
