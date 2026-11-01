import pc from 'picocolors'
import type { Level, UpliftVerdict } from '../core/ids.js'
import type { Permissions } from '../core/schema.js'
import { AGENT_INFO } from './agents.js'
import type { CompileResult } from './compile.js'
import type { JsonValue } from './types.js'
import type { Change } from './workspace.js'

type Out = (line?: string) => void

const LEVEL_COLOR: Record<Level, (s: string) => string> = {
  verified: pc.green,
  validated: pc.cyan,
  submitted: pc.yellow,
  revoked: pc.red,
}
const UPLIFT_COLOR: Record<UpliftVerdict, (s: string) => string> = {
  proven: pc.green,
  'no-effect': pc.dim,
  inconclusive: pc.yellow,
  untested: pc.dim,
  harmful: pc.red,
}

export interface Trust {
  level?: Level
  uplift?: UpliftVerdict
  source: string
}

export function renderHeader(out: Out, c: CompileResult, trust: Trust): void {
  const m = c.capability.manifest
  out(`${pc.bold(`${m.id}@${m.version}`)}  ${pc.dim(c.capability.digest)}`)
  out(`  ${m.summary}`)
  const level = trust.level
    ? LEVEL_COLOR[trust.level](trust.level)
    : pc.yellow('local, not in a registry')
  const uplift = trust.uplift
    ? UPLIFT_COLOR[trust.uplift](`uplift ${trust.uplift}`)
    : pc.dim('uplift unknown')
  out(`  trust        ${level} · ${uplift}`)
  out(`  source       ${trust.source}`)
  out(`  permissions  ${describePermissions(m.permissions)}`)
}

export function describePermissions(p: Permissions): string {
  const list = (xs: string[]) => (xs.length ? xs.join(', ') : 'none')
  return `network ${list(p.network)} · shell ${list(p.shell)} · files ${p.filesystem} · env ${list(p.env)}`
}

export function renderAgents(out: Out, c: CompileResult): void {
  for (const r of c.results) {
    const name = AGENT_INFO[r.agent].name
    if (r.result.status === 'supported') out(`  ${pc.green('✓')} ${name}`)
    else out(`  ${pc.dim('–')} ${name}: ${pc.dim(r.result.reason)}`)
  }
}

export function renderHooks(out: Out, c: CompileResult): void {
  const runs = hookCommands(c)
  if (!runs.length) return
  out(
    `  ${pc.bold('hooks will run')} ${pc.dim('(by the agent, on these events; Sigil never runs them)')}`,
  )
  for (const r of runs)
    out(`    ${pc.yellow(r.event)}${r.matcher ? pc.dim(` [${r.matcher}]`) : ''}  ${r.command}`)
}

export function renderNotes(out: Out, c: CompileResult, extra: string[] = []): void {
  const seen = new Set<string>()
  for (const r of c.results) {
    if (r.result.status !== 'supported') continue
    for (const n of r.result.notes) {
      if (seen.has(n.message)) continue
      seen.add(n.message)
      out(`  ${n.level === 'warn' ? pc.yellow('!') : pc.dim('i')} ${n.message}`)
    }
  }
  for (const n of extra) out(`  ${pc.dim('i')} ${n}`)
}

export function renderChanges(out: Out, changes: Change[], c?: CompileResult): void {
  for (const ch of changes) {
    const sign =
      ch.after === null ? pc.red('-') : ch.before === undefined ? pc.green('+') : pc.yellow('~')
    const agents = c?.ops.find((p) => p.op.path === ch.path)?.agents
    out(`  ${sign} ${ch.path}${agents ? pc.dim(`  ${agents.join(', ')}`) : ''}`)
  }
  if (!c) return
  for (const { op } of c.ops) {
    if (op.kind === 'json')
      out(
        `      ${pc.dim(`${op.path}: ${op.pointer.join('.')} ${op.op === 'append' ? '+=' : '='}`)} ${short(op.value)}`,
      )
    else if (op.kind === 'block')
      out(`      ${pc.dim(`${op.path}: block ${op.id} (${op.content.split('\n').length} lines)`)}`)
  }
}

function short(v: JsonValue): string {
  const s = JSON.stringify(v)
  return s.length > 160 ? `${s.slice(0, 157)}...` : s
}

export interface HookRun {
  event: string
  matcher?: string
  command: string
}

/** Every command a compiled hook will make an agent run, for the install preview. */
export function hookCommands(c: CompileResult): HookRun[] {
  const out: HookRun[] = []
  const seen = new Set<string>()
  const add = (r: HookRun) => {
    const key = `${r.event}|${r.matcher}|${r.command}`
    if (!seen.has(key)) {
      seen.add(key)
      out.push(r)
    }
  }
  for (const { op } of c.ops) {
    if (op.kind === 'json' && op.pointer[0] === 'hooks' && op.pointer[1]) {
      const v = op.value as { matcher?: string; hooks?: { command?: string }[] }
      for (const h of v.hooks ?? [])
        if (h.command)
          add({
            event: op.pointer[1],
            ...(v.matcher ? { matcher: v.matcher } : {}),
            command: h.command,
          })
    }
    if (op.kind === 'file' && /^\.github\/hooks\/[^/]+\.json$/.test(op.path)) {
      const cfg = JSON.parse(op.content.toString('utf8')) as {
        hooks: Record<string, { bash: string; matcher?: string }[]>
      }
      for (const [event, hs] of Object.entries(cfg.hooks))
        for (const h of hs)
          add({ event, ...(h.matcher ? { matcher: h.matcher } : {}), command: h.bash })
    }
  }
  return out
}
