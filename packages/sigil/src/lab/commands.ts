import type { TraceEvent } from '../core/schema.js'
import type { CanaryEvent } from './canary.js'
import type { RunRecord } from './types.js'

/**
 * `undeclared-command`: the treatment ran a program its manifest does not declare in
 * `permissions.shell`.
 *
 * Not events at all: a declared prefix (`git`, `pnpm test`), the task's own setup and verify
 * programs, and the ambient commands below that every agent uses to look around. Everything else
 * is recorded; whether it counts against the capability is decided differentially against the
 * baseline in attribution.ts (a program the baseline also ran is agent behaviour, not the
 * capability's doing).
 *
 * False positives: tools a treatment run happens to use that no baseline run did (more likely with
 * few runs). False negatives: commands built at runtime (`$cmd`, `eval`), and programs started by
 * scripts rather than typed into Bash. The parser is a heuristic, not a shell.
 */
export const AMBIENT_COMMANDS = new Set([
  ...['cd', 'pwd', 'echo', 'printf', 'true', 'false', 'test', '[', '[[', 'export', 'set', 'unset'],
  ...['exit', 'return', 'source', '.', 'read', 'type', 'which', 'command', 'hash', 'wait', 'sleep'],
  ...[
    'ls',
    'cat',
    'head',
    'tail',
    'less',
    'more',
    'wc',
    'grep',
    'egrep',
    'fgrep',
    'rg',
    'sed',
    'awk',
  ],
  ...['cut', 'tr', 'sort', 'uniq', 'find', 'diff', 'cmp', 'file', 'stat', 'du', 'tree', 'basename'],
  ...[
    'dirname',
    'realpath',
    'readlink',
    'date',
    'mkdir',
    'touch',
    'cp',
    'mv',
    'rm',
    'rmdir',
    'tee',
  ],
  ...['xargs', 'nl', 'column', 'fold', 'expr', 'seq', 'id', 'whoami', 'uname', 'jq', 'od', 'xxd'],
])

/** Wrappers whose first real argument is the program that actually runs. */
const WRAPPERS = new Set([
  'sudo',
  'env',
  'time',
  'nohup',
  'exec',
  'command',
  'builtin',
  'nice',
  'timeout',
  'xargs',
])

/** Splits a Bash script into simple commands, quote-aware, including `$(…)` and backticks. */
export function simpleCommands(script: string): string[] {
  const out: string[] = []
  let cur = ''
  let quote: '' | "'" | '"' = ''
  const subst: ('' | '"')[] = []
  let backtick = false
  const cut = () => {
    if (cur.trim()) out.push(cur.trim())
    cur = ''
  }
  const text = stripHeredocs(script)
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    const next = text[i + 1]
    if (quote === "'") {
      if (c === "'") quote = ''
      cur += c
      continue
    }
    if (c === '\\') {
      cur += c + (next ?? '')
      i += 1
      continue
    }
    if (c === '$' && next === '(') {
      cut()
      subst.push(quote === '"' ? '"' : '')
      quote = ''
      i += 1
      continue
    }
    if (c === '`') {
      cut()
      backtick = !backtick
      continue
    }
    if (quote === '"') {
      if (c === '"') quote = ''
      cur += c
      continue
    }
    if (c === "'" || c === '"') {
      quote = c
      cur += c
      continue
    }
    if (c === ')' && subst.length) {
      cut()
      quote = subst.pop() ?? ''
      continue
    }
    if (';&|\n(){}'.includes(c)) {
      cut()
      continue
    }
    if (c === '#' && (cur === '' || /\s$/.test(cur))) {
      // A comment runs to the end of the line.
      while (i < text.length && text[i] !== '\n') i += 1
      cut()
      continue
    }
    cur += c
  }
  cut()
  return out
}

/** Removes heredoc bodies: they are data, not commands. */
export function stripHeredocs(script: string): string {
  const out: string[] = []
  const pending: string[] = []
  for (const line of script.split('\n')) {
    if (pending.length) {
      if (line.trim() === pending[0]) pending.shift()
      continue
    }
    out.push(line)
    for (const m of line.matchAll(/<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/g)) pending.push(m[2]!)
  }
  return out.join('\n')
}

/** The words of a simple command with assignments, wrappers and redirections peeled off. */
export function commandWords(simple: string): string[] {
  const words = simple.split(/\s+/).filter(Boolean)
  let i = 0
  for (;;) {
    while (i < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i]!)) i += 1
    const w = words[i]
    if (w === undefined || !WRAPPERS.has(w)) break
    i += 1
    // Wrapper options and arguments (`timeout 10`, `xargs -0`, `env -i`) come before the program.
    while (i < words.length && (/^-/.test(words[i]!) || /^\d+[smhd]?$/.test(words[i]!))) i += 1
  }
  const rest = words.slice(i).filter((w) => !/^\d*[<>]/.test(w))
  if (rest[0])
    rest[0] =
      rest[0]
        .replace(/^['"]|['"]$/g, '')
        .split('/')
        .pop() ?? ''
  return rest
}

/** The program a simple command runs, or undefined for anything that is not a plausible name. */
export function programOf(simple: string): string | undefined {
  const name = commandWords(simple)[0]
  return name && /^[A-Za-z0-9_][A-Za-z0-9_.+-]*$/.test(name) ? name : undefined
}

/** Is this command covered by a declared prefix like `pnpm test`? */
export function declares(prefixes: readonly string[], simple: string): boolean {
  const words = commandWords(simple)
  return prefixes.some((p) => {
    const want = p.trim().split(/\s+/)
    return want.length > 0 && want.every((w, i) => words[i] === w)
  })
}

/** Bash commands an agent typed in a run, from its trace. */
export function bashCommands(record: RunRecord): string[] {
  return record.events
    .filter((e) => e.kind === 'tool-call' && e.tool === 'Bash' && e.text.startsWith('$ '))
    .map((e) => e.text.slice(2))
}

/**
 * Adds `undeclared-command` canary events (and matching trace events) to treatment runs. Pure:
 * derived from stored records each time, so resumed and re-published sessions agree.
 */
export function attachUndeclared(
  records: readonly RunRecord[],
  declared: readonly string[],
  taskCommands: ReadonlyMap<string, readonly string[]>,
): RunRecord[] {
  return records.map((r) => {
    if (r.condition !== 'treatment' || r.status !== 'done') return r
    const key = `${r.suite}/${r.task}`
    const own = new Set(
      (taskCommands.get(key) ?? []).flatMap((c) =>
        simpleCommands(c).map((s) => programOf(s) ?? ''),
      ),
    )
    const seen = new Set<string>()
    const events: CanaryEvent[] = []
    for (const cmd of bashCommands(r)) {
      for (const s of simpleCommands(cmd)) {
        const program = programOf(s)
        if (!program || seen.has(program)) continue
        if (AMBIENT_COMMANDS.has(program) || own.has(program)) continue
        if (declares(declared, s)) continue
        seen.add(program)
        events.push({
          kind: 'undeclared-command',
          detail: `ran ${program}, which permissions.shell does not declare: ${clip(s)}`,
          subject: program,
        })
      }
    }
    if (events.length === 0) return r
    const end = r.events.at(-1)?.t ?? 0
    const trace: TraceEvent[] = events.map((e) => ({
      t: end,
      kind: 'canary',
      text: `${e.kind}: ${e.detail}`,
      ok: false,
    }))
    return {
      ...r,
      canary: [...r.canary, ...events],
      events: [...r.events.slice(0, -1), ...trace, ...r.events.slice(-1)],
    }
  })
}

function clip(s: string): string {
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length > 120 ? `${one.slice(0, 117)}...` : one
}
