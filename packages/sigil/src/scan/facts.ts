import { WRITE_OP } from './rules/rule.js'
import { hostOf, isPlaceholderHost, URL_RE } from './text.js'
import type { Facts, Line, Use } from './types.js'

/** Shell words that precede the real command and should be skipped when naming it. */
const SKIP = new Set([
  'sudo',
  'env',
  'command',
  'exec',
  'nohup',
  'time',
  'then',
  'do',
  'else',
  'elif',
  'nice',
  'ionice',
  'setsid',
  'builtin',
  'xargs',
  'eval',
  'stdbuf',
  'timeout',
  'doas',
  'run',
  '!',
])
/** Builtins and keywords that are not worth reporting as commands. */
const BUILTIN = new Set([
  'cd',
  'echo',
  'printf',
  'test',
  'true',
  'false',
  'set',
  'export',
  'unset',
  'local',
  'readonly',
  'declare',
  'typeset',
  'read',
  'return',
  'exit',
  'shift',
  'break',
  'continue',
  'wait',
  'trap',
  'source',
  '.',
  'alias',
  'unalias',
  'pushd',
  'popd',
  'if',
  'fi',
  'for',
  'while',
  'until',
  'case',
  'esac',
  'function',
  'select',
  'let',
  'printenv',
  'pwd',
  'umask',
  'type',
  'hash',
  'jobs',
  'fg',
  'bg',
  'kill',
  'getopts',
  'ulimit',
  'help',
  'logout',
  'times',
  'caller',
  'enable',
  'mapfile',
])
const ENV_NAMES =
  /\$\{?([A-Z_][A-Z0-9_]*)\b|\bprocess\.env\.([A-Za-z_$][\w$]*)|\bprocess\.env\[['"]([^'"\]]+)|\bos\.environ(?:\.get)?\(?\[?['"]([^'"\]]+)|\bos\.getenv\(['"]([^'"]+)|%([A-Z_][A-Z0-9_]*)%|\bENV\[['"]([^'"\]]+)|\bgetenv\(['"]([^'"]+)/g
/** Common runtime variables that are not interesting as declared permissions. */
const COMMON_ENV = new Set([
  'PATH',
  'HOME',
  'PWD',
  'OLDPWD',
  'USER',
  'LOGNAME',
  'SHELL',
  'TERM',
  'LANG',
  'LC_ALL',
  'TMPDIR',
  'TMP',
  'TEMP',
  'CI',
  'HOSTNAME',
  'DISPLAY',
  'EDITOR',
  'PAGER',
  'SHLVL',
  'IFS',
  'PS1',
  'PS2',
  'RANDOM',
  'UID',
  'EUID',
  'GROUPS',
  'OSTYPE',
  'MACHTYPE',
  'HOSTTYPE',
  'COLUMNS',
  'LINES',
  'PYTHONPATH',
  'NODE_ENV',
  'VIRTUAL_ENV',
  'GOPATH',
  'GOROOT',
  'CARGO_HOME',
])

function add(map: Map<string, Use>, key: string, line: Line, file: string): void {
  const prev = map.get(key)
  if (prev) prev.count++
  else map.set(key, { file, line: line.n, kind: line.kind, count: 1 })
}

/** The leading command name (plus a word subcommand) of each shell statement on a line. */
function commandsOf(text: string): string[] {
  const out: string[] = []
  for (const stmt of text.split(/(?:&&|\|\||[;|&\n]|\$\(|`|\{|\}|\(|\))+/)) {
    const tokens = stmt.trim().split(/\s+/).filter(Boolean)
    let i = 0
    while (
      i < tokens.length &&
      (SKIP.has(tokens[i]!) || /^[A-Za-z_][\w]*=/.test(tokens[i]!) || tokens[i]!.startsWith('-'))
    )
      i++
    let name = tokens[i]
    if (!name) continue
    name =
      name
        .replace(/^['"(]+|['")]+$/g, '')
        .split('/')
        .at(-1) ?? name
    if (!/^[A-Za-z][\w.+-]*$/.test(name) || BUILTIN.has(name)) continue
    const sub = tokens[i + 1]
    out.push(sub && /^[a-z][\w-]*$/i.test(sub) && !sub.startsWith('-') ? `${name} ${sub}` : name)
  }
  return out
}

/** Gathers hosts, commands, env vars and writes for manifest conformance. Examples do not count. */
export function collectFacts(lines: readonly Line[], file: string, facts: Facts): void {
  for (const l of lines) {
    if (l.kind === 'example') continue
    for (const m of l.text.matchAll(URL_RE)) {
      const host = hostOf(m[0])
      if (host && !isPlaceholderHost(host)) add(facts.hosts, host, l, file)
    }
    for (const m of l.text.matchAll(ENV_NAMES)) {
      const name = m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5] ?? m[6] ?? m[7] ?? m[8]
      if (name && /^[A-Z_][A-Z0-9_]*$/.test(name) && !COMMON_ENV.has(name))
        add(facts.env, name, l, file)
    }
    if (l.shell) {
      for (const cmd of commandsOf(l.text)) add(facts.commands, cmd, l, file)
      if (WRITE_OP.test(l.text) && !/>\s*\/dev\/(?:null|stderr|stdout|tty)\b/.test(l.text)) {
        facts.writes.push({ file, line: l.n, kind: l.kind, count: 1 })
      }
    }
  }
}

export function emptyFacts(): Facts {
  return { hosts: new Map(), commands: new Map(), env: new Map(), writes: [], allowedTools: [] }
}
