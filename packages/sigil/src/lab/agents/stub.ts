import type { LabCapability } from '../capability.js'
import { compiledInstallFiles } from '../compiled-install.js'
import type { AgentDriver, AgentOutcome, RawEvent, StampedLine } from './types.js'

/**
 * A scripted stand-in for a coding agent. It proves the sandbox, proxy, canaries, tamper detection
 * and scoring end to end without a model: it edits files, reads honeytokens and tries egress exactly
 * as told. Never registered as a real agent; results it produces are never written as evidence.
 */
export type StubStep =
  | { say: string }
  | { bash: string }
  | { read: string }
  | { write: { path: string; content: string } }
  /** Branch on whether a skill was installed for this condition, like a capability changing behaviour. */
  | { ifSkill: string; steps: StubStep[]; otherwise?: StubStep[] }
  | { done: string }

export interface StubPlan {
  steps: StubStep[]
}

/** Runs inside the sandbox via `node -e`. Self-contained for the same reason as the proxy program. */
export function stubAgentProgram(): void {
  const fs = process.getBuiltinModule('node:fs')
  const cp = process.getBuiltinModule('node:child_process')
  const path = process.getBuiltinModule('node:path')
  type Step = Record<string, unknown>
  const emit = (e: Record<string, unknown>) => process.stdout.write(`${JSON.stringify(e)}\n`)
  const home = process.env.HOME ?? ''
  const expand = (p: string) => path.resolve(p.replace(/^~(?=$|\/)/, home))
  const plan = JSON.parse(fs.readFileSync(0, 'utf8')) as { steps: Step[] }
  let final = ''
  emit({ type: 'init', cwd: process.cwd(), home, uid: process.getuid?.() ?? -1 })
  const run = (steps: Step[]) => {
    for (const s of steps) {
      if (typeof s.say === 'string') {
        emit({ type: 'event', kind: 'assistant', text: s.say })
      } else if (typeof s.bash === 'string') {
        emit({
          type: 'event',
          kind: 'tool-call',
          tool: 'Bash',
          text: `$ ${s.bash}`,
          input: { command: s.bash },
        })
        const r = cp.spawnSync('/bin/sh', ['-c', s.bash], { encoding: 'utf8', timeout: 60_000 })
        emit({
          type: 'event',
          kind: 'tool-result',
          tool: 'Bash',
          text: `${r.stdout ?? ''}${r.stderr ?? ''}`,
          ok: r.status === 0,
        })
      } else if (typeof s.read === 'string') {
        emit({
          type: 'event',
          kind: 'tool-call',
          tool: 'Read',
          text: `Read ${s.read}`,
          input: { file_path: s.read },
        })
        try {
          emit({
            type: 'event',
            kind: 'tool-result',
            tool: 'Read',
            text: fs.readFileSync(expand(s.read), 'utf8'),
            ok: true,
          })
        } catch (e) {
          emit({ type: 'event', kind: 'tool-result', tool: 'Read', text: String(e), ok: false })
        }
      } else if (s.write && typeof s.write === 'object') {
        const w = s.write as { path: string; content: string }
        emit({
          type: 'event',
          kind: 'tool-call',
          tool: 'Write',
          text: `Write ${w.path}`,
          input: { file_path: w.path, content: w.content },
        })
        try {
          fs.mkdirSync(path.dirname(expand(w.path)), { recursive: true })
          fs.writeFileSync(expand(w.path), w.content)
          emit({ type: 'event', kind: 'tool-result', tool: 'Write', text: 'ok', ok: true })
        } catch (e) {
          emit({ type: 'event', kind: 'tool-result', tool: 'Write', text: String(e), ok: false })
        }
      } else if (typeof s.ifSkill === 'string') {
        const has = fs.existsSync(path.join('.claude', 'skills', s.ifSkill, 'SKILL.md'))
        run(((has ? s.steps : s.otherwise) ?? []) as Step[])
      } else if (typeof s.done === 'string') {
        final = s.done
        emit({ type: 'event', kind: 'assistant', text: s.done })
      }
    }
  }
  run(plan.steps)
  emit({ type: 'result', result: final })
}

export function stubSource(): string {
  return `(${stubAgentProgram.toString()})()`
}

export function parseStubStream(lines: readonly StampedLine[]): AgentOutcome {
  const events: RawEvent[] = []
  let finalMessage = ''
  let cwd: string | undefined
  let home: string | undefined
  let sawResult = false
  for (const { t, line } of lines) {
    let ev: Record<string, unknown>
    try {
      ev = JSON.parse(line) as Record<string, unknown>
    } catch {
      continue
    }
    if (ev.type === 'init') {
      cwd = typeof ev.cwd === 'string' ? ev.cwd : undefined
      home = typeof ev.home === 'string' ? ev.home : undefined
      events.push({
        t,
        kind: 'system',
        text: `stub agent started in ${cwd} as uid ${String(ev.uid)}`,
      })
    } else if (ev.type === 'event') {
      const e: RawEvent = { t, kind: ev.kind as RawEvent['kind'], text: String(ev.text ?? '') }
      if (typeof ev.tool === 'string') e.tool = ev.tool
      if (ev.input && typeof ev.input === 'object') e.input = ev.input as Record<string, unknown>
      if (typeof ev.ok === 'boolean') e.ok = ev.ok
      events.push(e)
    } else if (ev.type === 'result') {
      sawResult = true
      finalMessage = String(ev.result ?? '')
    }
  }
  const outcome: AgentOutcome = {
    events,
    finalMessage,
    tokens: 0,
    model: 'stub',
    version: 'stub-1',
  }
  if (!sawResult) outcome.error = 'stub agent produced no result'
  outcome.environment = {
    tools: ['Bash', 'Read', 'Write'],
    skills: [],
    agents: [],
    plugins: [],
    mcpServers: [],
    memoryPaths: home ? [home] : [],
    ...(cwd ? { cwd } : {}),
  }
  return outcome
}

export function stubDriver(plan: StubPlan, egress: readonly string[] = []): AgentDriver {
  return {
    id: 'generic',
    label: 'Sigil stub agent',
    egress,
    harnessDenied: [],
    stateGlobs: [],
    persistenceGlobs: [],
    dockerLayers: () => [],
    versionArgv: () => ['node', '--version'],
    parseVersion: (stdout) => {
      const v = /v?(\d+\.\d+\.\d+)/.exec(stdout)?.[1]
      return v ? `stub+node${v}` : undefined
    },
    installFiles: (capability: LabCapability, repoDir: string) =>
      compiledInstallFiles(capability, 'claude-code', repoDir),
    installedNames: () => [],
    invocation: () => ({
      argv: ['node', '-e', stubSource()],
      env: {},
      secretEnv: {},
      stdin: JSON.stringify(plan),
    }),
    parse: (lines) => parseStubStream(lines),
    isolationProblems: (outcome, ctx) => {
      const env = outcome.environment
      const problems: string[] = []
      if (env?.cwd && env.cwd !== ctx.workDir)
        problems.push(`stub ran in ${env.cwd}, not ${ctx.workDir}`)
      if (env?.memoryPaths[0] && env.memoryPaths[0] !== ctx.homeDir)
        problems.push(`stub HOME is ${env.memoryPaths[0]}`)
      return problems
    },
  }
}
