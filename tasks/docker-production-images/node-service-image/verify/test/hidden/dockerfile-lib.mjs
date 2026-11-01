// Hidden verifier support: reads a Dockerfile, its .dockerignore and the build script statically and
// simulates a BuildKit build closely enough to answer "what ends up in the final image": which stage
// is final, which files reach it and where they came from, its USER/ENV/WORKDIR/ENTRYPOINT/CMD/
// HEALTHCHECK, which steps a source change invalidates, and where a build secret can persist.
// No Docker daemon and no network are used.
//
// The parser follows moby/buildkit frontend/dockerfile/parser (dockerfile 1.28): parser directives,
// the escape directive, line continuations, comment lines inside continuations, heredocs, JSON vs
// shell form, builder flags. .dockerignore matching follows moby/patternmatcher.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, posix } from 'node:path'

/* ---------------------------------------------------------------------------------------------- */
/* Dockerfile parser                                                                               */
/* ---------------------------------------------------------------------------------------------- */

const DIRECTIVE_RE = /^([a-zA-Z][a-zA-Z0-9]*)\s*=\s*(.+?)\s*$/
const DIRECTIVES = new Set(['syntax', 'escape', 'check'])
const HEREDOC_CMDS = new Set(['RUN', 'COPY', 'ADD'])

export class DockerfileError extends Error {}

function continuationRe(esc) {
  const e = esc === '`' ? '`' : '\\\\'
  return new RegExp(`([^${e}])${e}[ \\t]*$|^${e}[ \\t]*$`)
}

/** Splits the instruction line into flags (`--x=y`) and the rest, like extractBuilderFlags. */
function extractFlags(line, esc) {
  const flags = []
  let i = 0
  for (;;) {
    while (i < line.length && /\s/.test(line[i])) i++
    if (!(line[i] === '-' && line[i + 1] === '-')) return { flags, rest: line.slice(i) }
    let word = ''
    let quote = null
    let blankOK = false
    for (; i <= line.length; i++) {
      const ch = line[i]
      if (i === line.length) break
      if (quote) {
        if (ch === quote) {
          quote = null
          continue
        }
        if (ch === esc && i + 1 < line.length) {
          i++
          word += line[i]
          continue
        }
        word += ch
        continue
      }
      if (/\s/.test(ch)) break
      if (ch === "'" || ch === '"') {
        quote = ch
        blankOK = true
        continue
      }
      if (ch === esc && i + 1 < line.length) {
        i++
        word += line[i]
        continue
      }
      word += ch
    }
    if (word === '--') return { flags, rest: line.slice(i).trimStart() }
    if (blankOK || word.length) flags.push(word)
  }
}

/** parseWords from line_parsers.go: whitespace-separated words, quotes kept in the word. */
export function parseWords(rest, esc = '\\') {
  const words = []
  let cur = ''
  let inWord = false
  let quote = null
  let blankOK = false
  for (let i = 0; i < rest.length; i++) {
    const ch = rest[i]
    if (!inWord) {
      if (/\s/.test(ch)) continue
      inWord = true
    }
    if (quote) {
      if (ch === quote) quote = null
      else if (ch === esc && quote !== "'" && i + 1 < rest.length) {
        cur += ch
        i++
        cur += rest[i]
        continue
      }
      cur += ch
      continue
    }
    if (/\s/.test(ch)) {
      if (blankOK || cur.length) words.push(cur)
      cur = ''
      inWord = false
      blankOK = false
      continue
    }
    if (ch === "'" || ch === '"') {
      quote = ch
      blankOK = true
    }
    if (ch === esc && i + 1 < rest.length) {
      cur += ch
      i++
      cur += rest[i]
      continue
    }
    cur += ch
  }
  if (inWord && (blankOK || cur.length)) words.push(cur)
  return words
}

function tryJSONArray(rest) {
  const t = rest.trimStart()
  if (!t.startsWith('[')) return undefined
  let v
  try {
    v = JSON.parse(t)
  } catch {
    return undefined
  }
  if (!Array.isArray(v)) return undefined
  if (!v.every((x) => typeof x === 'string'))
    throw new DockerfileError('when using JSON array syntax, arrays must be comprised of strings only')
  return v
}

/** Words for heredoc detection (raw quotes kept), then match `[n]<<[-]WORD`. */
function heredocsInLine(line) {
  const out = []
  for (const w of parseWords(line)) {
    const m = /^(\d*)<<(-?)\s*([^<]*)$/.exec(w)
    if (!m || !m[3]) continue
    const raw = m[3]
    const name = raw.replace(/^(['"])(.*)\1$/, '$2').replace(/["']/g, '')
    if (!name) continue
    out.push({ fd: m[1] ? Number(m[1]) : 0, chomp: m[2] === '-', name, expand: !/["']/.test(raw) })
  }
  return out
}

/**
 * Parses Dockerfile text into instructions. Each instruction has `cmd` (upper case), `flags`
 * (raw `name=value` strings without the leading dashes), `rest` (raw argument text), `json` (exec
 * form array or null) and `heredocs`.
 */
export function parseDockerfile(text) {
  let src = text.replace(/^\uFEFF/, '')
  const lines = src.split(/(?<=\n)/)
  const directives = {}
  let directivesDone = false
  let esc = '\\'
  let contRe = continuationRe(esc)
  const instructions = []
  const warnings = []

  const isComment = (l) => /^\s*#/.test(l)
  const trimNl = (l) => l.replace(/[\r\n]+$/, '')

  function directive(line) {
    if (directivesDone) return false
    if (!line.startsWith('#')) {
      directivesDone = true
      return false
    }
    const m = DIRECTIVE_RE.exec(line.slice(1).trimStart())
    if (!m || !DIRECTIVES.has(m[1].toLowerCase())) {
      directivesDone = true
      return false
    }
    const k = m[1].toLowerCase()
    if (k in directives) throw new DockerfileError(`only one ${k} parser directive can be used`)
    directives[k] = m[2]
    if (k === 'escape') {
      if (m[2] !== '`' && m[2] !== '\\')
        throw new DockerfileError(`invalid escape token '${m[2]}' does not match \` or \\`)
      esc = m[2]
      contRe = continuationRe(esc)
    }
    return true
  }

  function processLine(raw, stripLeft) {
    let l = trimNl(raw)
    if (stripLeft) l = l.replace(/^\s+/, '')
    directive(l)
    return isComment(l) ? '' : l
  }

  function trimCont(l) {
    if (contRe.test(l)) return { line: l.replace(contRe, '$1'), end: false }
    return { line: l, end: true }
  }

  let i = 0
  while (i < lines.length) {
    const startLine = i + 1
    const first = processLine(lines[i], true)
    i++
    let { line, end } = trimCont(first)
    if (end && line.length === 0) continue
    let buf = line
    while (!end && i < lines.length) {
      const rawNext = lines[i]
      const next = processLine(rawNext, false)
      i++
      if (isComment(rawNext)) continue
      if (trimNl(next).trim() === '') {
        warnings.push(`empty continuation line at ${i}`)
        continue
      }
      ;({ line, end } = trimCont(next))
      buf += line
    }
    const full = buf
    const m = /^\s*(\S+)(?:\s+([\s\S]*))?$/.exec(full)
    if (!m) continue
    const cmd = m[1].toUpperCase()
    let { flags, rest } = m[2] ? extractFlags(m[2], esc) : { flags: [], rest: '' }
    rest = rest.trim()
    const ins = { cmd, flags, rest, json: null, heredocs: [], line: startLine, original: full }
    if (['RUN', 'CMD', 'ENTRYPOINT', 'SHELL'].includes(cmd)) ins.json = tryJSONArray(rest) ?? null
    else if (['COPY', 'ADD', 'VOLUME'].includes(cmd)) ins.json = tryJSONArray(rest) ?? null
    else if (cmd === 'HEALTHCHECK') {
      const hm = /^(\S+)\s*([\s\S]*)$/.exec(rest)
      ins.healthType = hm ? hm[1].toUpperCase() : ''
      ins.healthRest = hm ? hm[2] : ''
      ins.json = hm ? (tryJSONArray(hm[2]) ?? null) : null
    }
    if (HEREDOC_CMDS.has(cmd) && !ins.json && full.includes('<<')) {
      for (const h of heredocsInLine(full)) {
        let content = ''
        let terminated = false
        while (i < lines.length) {
          const raw = lines[i]
          i++
          let possible = trimNl(raw)
          if (h.chomp) possible = possible.replace(/^\t+/, '')
          if (possible === h.name) {
            terminated = true
            break
          }
          content += raw
        }
        if (!terminated) throw new DockerfileError(`unterminated heredoc ${h.name}`)
        if (h.chomp) content = content.replace(/^\t+/gm, '')
        ins.heredocs.push({ ...h, content })
      }
    }
    ins.endLine = i
    instructions.push(ins)
  }
  if (!instructions.length) throw new DockerfileError('file with no instructions')
  return { directives, escape: esc, instructions, warnings }
}

export function flagValues(ins, name) {
  const out = []
  for (const f of ins.flags) {
    const eq = f.indexOf('=')
    const k = (eq === -1 ? f : f.slice(0, eq)).replace(/^-+/, '').toLowerCase()
    if (k === name) out.push(eq === -1 ? 'true' : f.slice(eq + 1))
  }
  return out
}
export const flagValue = (ins, name) => flagValues(ins, name).at(-1)

/* ---------------------------------------------------------------------------------------------- */
/* Dockerfile word expansion (shell.Lex.ProcessWord): quotes, escapes and ${} forms                */
/* ---------------------------------------------------------------------------------------------- */

function globToRegexSource(pat) {
  let re = ''
  for (let i = 0; i < pat.length; i++) {
    const c = pat[i]
    if (c === '*') re += '.*'
    else if (c === '?') re += '.'
    else if (c === '[') {
      const end = pat.indexOf(']', i + 1)
      if (end === -1) re += '\\['
      else {
        re += pat.slice(i, end + 1).replace(/^\[!/, '[^')
        i = end
      }
    } else re += c.replace(/[.+^${}()|\\/]/g, '\\$&')
  }
  return re
}

function applyModifier(name, op, word, vars) {
  const set = Object.hasOwn(vars, name)
  const val = set ? String(vars[name]) : ''
  switch (op) {
    case ':-':
      return set && val !== '' ? val : word
    case '-':
      return set ? val : word
    case ':+':
      return set && val !== '' ? word : ''
    case '+':
      return set ? word : ''
    case ':?':
    case '?':
      if (!set || (op === ':?' && val === '')) throw new DockerfileError(`${name}: ${word || 'is not allowed to be unset'}`)
      return val
    case '#':
    case '##': {
      const re = new RegExp(`^${globToRegexSource(word).replace(/\.\*/g, op === '#' ? '.*?' : '.*')}`)
      return val.replace(re, '')
    }
    case '%':
    case '%%': {
      for (let k = op === '%' ? val.length : 0; op === '%' ? k >= 0 : k <= val.length; k += op === '%' ? -1 : 1) {
        if (new RegExp(`^${globToRegexSource(word)}$`).test(val.slice(k))) return val.slice(0, k)
      }
      return val
    }
    default:
      return val
  }
}

/** Expands one Dockerfile word: removes quotes and substitutes $VAR / ${VAR...} from `vars`. */
export function processWord(word, vars = {}, esc = '\\') {
  let out = ''
  let i = 0
  const readVar = () => {
    // at '$'
    i++
    if (word[i] === '{') {
      const end = matchBrace(word, i)
      const inner = word.slice(i + 1, end)
      i = end + 1
      const m = /^([A-Za-z_][A-Za-z0-9_]*|[0-9]+)(.*)$/s.exec(inner)
      if (!m) return ''
      const [, name, mod] = m
      if (!mod) return Object.hasOwn(vars, name) ? String(vars[name]) : ''
      const mm = /^(:-|:\+|:\?|-|\+|\?|##|#|%%|%|\/\/|\/)(.*)$/s.exec(mod)
      if (!mm) return Object.hasOwn(vars, name) ? String(vars[name]) : ''
      if (mm[1] === '/' || mm[1] === '//') {
        const [pat, rep = ''] = mm[2].split('/')
        const val = Object.hasOwn(vars, name) ? String(vars[name]) : ''
        const re = new RegExp(globToRegexSource(pat), mm[1] === '//' ? 'g' : '')
        return val.replace(re, rep)
      }
      return applyModifier(name, mm[1], processWord(mm[2], vars, esc), vars)
    }
    const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(word.slice(i))
    if (!m) return '$'
    i += m[0].length
    return Object.hasOwn(vars, m[0]) ? String(vars[m[0]]) : ''
  }
  while (i < word.length) {
    const ch = word[i]
    if (ch === "'") {
      const end = word.indexOf("'", i + 1)
      out += end === -1 ? word.slice(i + 1) : word.slice(i + 1, end)
      i = end === -1 ? word.length : end + 1
    } else if (ch === '"') {
      i++
      while (i < word.length && word[i] !== '"') {
        if (word[i] === esc && i + 1 < word.length && ['"', '$', esc].includes(word[i + 1])) {
          out += word[i + 1]
          i += 2
        } else if (word[i] === '$') out += readVar()
        else out += word[i++]
      }
      i++
    } else if (ch === esc) {
      if (i + 1 < word.length) out += word[i + 1]
      i += 2
    } else if (ch === '$') out += readVar()
    else out += word[i++]
  }
  return out
}

function matchBrace(s, open) {
  let depth = 0
  for (let k = open; k < s.length; k++) {
    if (s[k] === '{') depth++
    else if (s[k] === '}') {
      depth--
      if (depth === 0) return k
    }
  }
  return s.length - 1
}

/** ENV/LABEL/ARG `key=value ...` pairs (or the legacy `key value` form). */
export function parseKeyValues(ins, vars, esc, { legacy = true } = {}) {
  const words = parseWords(ins.rest, esc)
  if (!words.length) return []
  if (legacy && !words[0].includes('=')) {
    const [k, ...v] = ins.rest.split(/\s+/)
    return [[k, processWord(v.join(' ').trim(), vars, esc)]]
  }
  return words.map((w) => {
    const eq = w.indexOf('=')
    if (eq === -1) return [processWord(w, vars, esc), undefined]
    return [processWord(w.slice(0, eq), vars, esc), processWord(w.slice(eq + 1), vars, esc)]
  })
}

/* ---------------------------------------------------------------------------------------------- */
/* .dockerignore (moby/patternmatcher + ignorefile.ReadAll)                                        */
/* ---------------------------------------------------------------------------------------------- */

export function cleanPath(p) {
  if (p === '') return '.'
  const abs = p.startsWith('/')
  const parts = []
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (parts.length && parts.at(-1) !== '..') parts.pop()
      else if (!abs) parts.push('..')
      continue
    }
    parts.push(seg)
  }
  const out = (abs ? '/' : '') + parts.join('/')
  return out || (abs ? '/' : '.')
}

export function readIgnoreFile(text) {
  const out = []
  text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .forEach((raw) => {
      if (raw.startsWith('#')) return
      let p = raw.trim()
      if (!p) return
      const invert = p[0] === '!'
      if (invert) p = p.slice(1).trim()
      if (p.length) {
        p = cleanPath(p)
        if (p.length > 1 && p[0] === '/') p = p.slice(1)
      }
      out.push(invert ? `!${p}` : p)
    })
  return out
}

/** Port of patternmatcher Pattern.compile for '/' separators. */
function compilePattern(p) {
  let re = '^'
  let type = 'exact'
  let pos = 0
  const peek = () => (pos < p.length ? p[pos] : undefined)
  for (let iter = 0; peek() !== undefined; iter++) {
    const ch = p[pos++]
    if (ch === '*') {
      if (peek() === '*') {
        pos++
        if (peek() === '/') pos++
        if (peek() === undefined) {
          if (type === 'exact') type = 'prefix'
          else {
            re += '.*'
            type = 'regexp'
          }
        } else {
          re += '(.*/)?'
          type = 'regexp'
        }
        if (iter === 0) type = 'suffix'
      } else {
        re += '[^/]*'
        type = 'regexp'
      }
    } else if (ch === '?') {
      re += '[^/]'
      type = 'regexp'
    } else if ('.+()|{}$'.includes(ch)) re += `\\${ch}`
    else if (ch === '\\') {
      if (peek() !== undefined) {
        re += `\\${p[pos++]}`
        type = 'regexp'
      } else re += '\\\\'
    } else if (ch === '[' || ch === ']') {
      re += ch
      type = 'regexp'
    } else re += ch
  }
  if (type === 'regexp') {
    try {
      return { type, re: new RegExp(`${re}$`) }
    } catch {
      return { type: 'bad' }
    }
  }
  return { type }
}

export class IgnoreMatcher {
  constructor(patterns) {
    this.patterns = patterns
      .map((raw) => raw.trim())
      .filter(Boolean)
      .map((raw) => {
        let p = cleanPath(raw)
        let exclusion = false
        if (p[0] === '!') {
          exclusion = true
          p = p.slice(1)
        }
        return { exclusion, cleaned: p, dirs: p.split('/'), c: compilePattern(p) }
      })
    this.exclusions = this.patterns.some((p) => p.exclusion)
  }
  static match(pattern, path) {
    const c = pattern.c
    const cp = pattern.cleaned
    if (c.type === 'exact') return path === cp
    if (c.type === 'prefix') return path.startsWith(cp.slice(0, -2))
    if (c.type === 'suffix') {
      const suffix = cp.slice(2)
      if (path.endsWith(suffix)) return true
      return suffix[0] === '/' && path === suffix.slice(1)
    }
    if (c.type === 'regexp') return c.re.test(path)
    return false
  }
  /** fsutil walk semantics: a path matches pattern i if it, or a parent directory, matched it. */
  matches(path) {
    const parts = path.split('/')
    const parentResults = []
    let matchedFinal = false
    for (let depth = 1; depth <= parts.length; depth++) {
      const p = parts.slice(0, depth).join('/')
      let matched = false
      const results = []
      this.patterns.forEach((pat, idx) => {
        let m = depth > 1 ? parentResults[idx] : false
        if (!m) {
          if (pat.exclusion !== matched) {
            results[idx] = false
            return
          }
          m = IgnoreMatcher.match(pat, p)
        }
        results[idx] = m
        if (m) matched = !pat.exclusion
      })
      parentResults.splice(0, parentResults.length, ...results)
      matchedFinal = matched
    }
    return matchedFinal
  }
}

/* ---------------------------------------------------------------------------------------------- */
/* Build context                                                                                   */
/* ---------------------------------------------------------------------------------------------- */

export function listTree(root, base = root, skip = () => false) {
  const out = []
  for (const e of readdirSync(root, { withFileTypes: true })) {
    const abs = join(root, e.name)
    const rel = abs.slice(base.length + 1)
    if (skip(rel)) continue
    if (e.isDirectory()) out.push(...listTree(abs, base, skip))
    else out.push(rel)
  }
  return out
}

/**
 * The build context as BuildKit would send it: every file under `root` that .dockerignore does not
 * exclude. `extra` adds virtual paths (for example a `.git` directory the sandbox may not have).
 */
export function buildContext(root, { ignoreFile = '.dockerignore', extra = [] } = {}) {
  const ignorePath = join(root, ignoreFile)
  const patterns = existsSync(ignorePath) ? readIgnoreFile(readFileSync(ignorePath, 'utf8')) : []
  const matcher = new IgnoreMatcher(patterns)
  const all = [...new Set([...listTree(root), ...extra])].sort()
  const files = all.filter((f) => !matcher.matches(f))
  return {
    root,
    patterns,
    matcher,
    all,
    files,
    has: (rel) => files.includes(rel),
    excluded: (rel) => matcher.matches(rel),
    read: (rel) => {
      const p = join(root, rel)
      return existsSync(p) && statSync(p).isFile() ? readFileSync(p, 'utf8') : undefined
    },
  }
}

/* ---------------------------------------------------------------------------------------------- */
/* Image references and the base images these tasks may meet                                      */
/* ---------------------------------------------------------------------------------------------- */

export function parseImageRef(ref) {
  let rest = ref.trim()
  let digest
  const at = rest.indexOf('@')
  if (at !== -1) {
    digest = rest.slice(at + 1)
    rest = rest.slice(0, at)
  }
  let tag
  const lastSlash = rest.lastIndexOf('/')
  const colon = rest.lastIndexOf(':')
  if (colon > lastSlash) {
    tag = rest.slice(colon + 1)
    rest = rest.slice(0, colon)
  }
  const parts = rest.split('/')
  let registry = 'docker.io'
  if (parts.length > 1 && (parts[0].includes('.') || parts[0].includes(':') || parts[0] === 'localhost')) {
    registry = parts.shift()
  }
  if (registry === 'index.docker.io') registry = 'docker.io'
  let path = parts.join('/')
  if (registry === 'docker.io' && !path.includes('/')) path = `library/${path}`
  return { registry, path, tag, digest, name: `${registry}/${path}`, short: path.replace(/^library\//, '') }
}

const NODE_USERS = { users: { root: 0, node: 1000 }, homes: { 0: '/root', 1000: '/home/node' } }
const NONROOT_USERS = { users: { root: 0, nonroot: 65532 }, homes: { 0: '/root', 65532: '/home/nonroot' } }
const DEFAULT_PATH = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'

/**
 * What a base image provides, from `docker buildx imagetools inspect` and file listings of the
 * images taken on 2026-11-01 (see references/sources.md). Unknown images return `known: false`.
 */
export function describeBaseImage(refText) {
  if (refText === 'scratch')
    return { known: true, family: 'scratch', user: '', workdir: '/', env: {}, entrypoint: null, cmd: null, shell: null, files: [], toolchain: false, libc: null, ca: false, tz: false, users: {}, homes: {} }
  const ref = parseImageRef(refText)
  const tag = (ref.tag ?? 'latest').toLowerCase()
  const base = { known: true, ref, entrypoint: null, cmd: null, env: { PATH: DEFAULT_PATH }, healthcheck: null }
  if (ref.name === 'docker.io/library/node') {
    const alpine = tag.includes('alpine')
    const slim = tag.includes('slim')
    const major = /^(\d+)/.exec(tag)?.[1]
    const files = ['/usr/local/bin/node', '/usr/local/bin/npm', '/usr/local/bin/npx', '/usr/local/bin/docker-entrypoint.sh', '/bin/sh']
    if (!alpine) files.push('/bin/bash')
    if (alpine) files.push('/usr/bin/wget', '/bin/busybox')
    if (!alpine && !slim) files.push('/usr/bin/curl', '/usr/bin/wget', '/usr/bin/gcc', '/usr/bin/make', '/usr/bin/python3', '/usr/bin/git')
    return {
      ...base,
      family: alpine ? 'node-alpine' : slim ? 'node-slim' : 'node-full',
      nodeMajor: major ? Number(major) : undefined,
      user: '',
      workdir: alpine ? '/' : '/',
      entrypoint: ['docker-entrypoint.sh'],
      cmd: ['node'],
      shell: alpine ? 'busybox' : 'dash',
      files,
      toolchain: !alpine && !slim,
      libc: alpine ? 'musl' : 'glibc',
      ca: true,
      tz: !alpine && !slim,
      npmGlobalConfig: '/usr/local/etc/npmrc',
      ...NODE_USERS,
    }
  }
  const distroless = /^distroless\/(static|base|base-nossl|cc|nodejs(\d+)|python3|java\d+)-debian(\d+)$/.exec(ref.path)
  if (ref.registry === 'gcr.io' && distroless) {
    const nonroot = tag.includes('nonroot')
    const debug = tag.includes('debug')
    const kind = distroless[1]
    const files = ['/etc/ssl/certs/ca-certificates.crt', '/usr/share/zoneinfo/Europe/Lisbon', '/etc/passwd']
    if (debug) files.push('/busybox/sh', '/busybox/wget')
    if (kind.startsWith('nodejs')) files.push('/nodejs/bin/node')
    return {
      ...base,
      family: kind.startsWith('nodejs') ? 'distroless-node' : `distroless-${kind}`,
      nodeMajor: distroless[2] ? Number(distroless[2]) : undefined,
      user: nonroot ? '65532' : '0',
      workdir: nonroot ? '/home/nonroot' : '/',
      entrypoint: kind.startsWith('nodejs') ? ['/nodejs/bin/node'] : null,
      env: { PATH: debug ? `${DEFAULT_PATH}:/busybox` : DEFAULT_PATH, SSL_CERT_FILE: '/etc/ssl/certs/ca-certificates.crt' },
      shell: debug ? 'busybox' : null,
      shellPath: debug ? '/busybox/sh' : null,
      files,
      toolchain: false,
      libc: kind === 'static' ? null : 'glibc',
      ca: true,
      tz: true,
      ...NONROOT_USERS,
    }
  }
  if (ref.registry === 'cgr.dev' && /^chainguard\/(node|static|glibc-dynamic|wolfi-base)$/.test(ref.path)) {
    const kind = ref.path.split('/')[1]
    const dev = tag.includes('dev')
    const files = ['/etc/ssl/certs/ca-certificates.crt', '/etc/passwd']
    let shell = null
    if (kind === 'node') files.push('/usr/bin/node', '/usr/bin/sh', '/bin/busybox')
    if (kind === 'node') shell = 'busybox'
    if (kind === 'wolfi-base' || dev) {
      files.push('/bin/sh', '/bin/busybox', '/usr/bin/wget')
      shell = 'busybox'
    }
    if (kind === 'static') files.push('/usr/share/zoneinfo/Europe/Lisbon')
    return {
      ...base,
      family: `chainguard-${kind}`,
      user: kind === 'wolfi-base' ? '' : '65532',
      workdir: kind === 'node' ? '/app' : '/',
      entrypoint: kind === 'node' ? ['/usr/bin/node'] : null,
      cmd: kind === 'node' ? ['--help'] : null,
      env: { PATH: DEFAULT_PATH, SSL_CERT_FILE: '/etc/ssl/certs/ca-certificates.crt' },
      shell,
      files,
      toolchain: dev,
      libc: kind === 'static' ? null : 'glibc',
      ca: true,
      tz: kind === 'static',
      users: kind === 'node' ? { root: 0, node: 65532 } : { root: 0, nonroot: 65532 },
      homes: kind === 'node' ? { 0: '/root', 65532: '/home/node' } : { 0: '/root', 65532: '/home/nonroot' },
    }
  }
  if (ref.name === 'docker.io/library/golang') {
    const alpine = tag.includes('alpine')
    return { ...base, family: alpine ? 'golang-alpine' : 'golang', user: '', workdir: '/go', shell: alpine ? 'busybox' : 'dash', files: ['/usr/local/go/bin/go', '/bin/sh'], toolchain: true, libc: alpine ? 'musl' : 'glibc', ca: true, tz: !alpine, cgoDefault: alpine ? '0' : '1', users: { root: 0 }, homes: { 0: '/root' } }
  }
  if (['docker.io/library/alpine', 'docker.io/library/busybox'].includes(ref.name)) {
    return { ...base, family: ref.short, user: '', workdir: '/', shell: 'busybox', files: ['/bin/sh', '/bin/busybox', '/usr/bin/wget'], toolchain: false, libc: ref.short === 'alpine' ? 'musl' : null, ca: ref.short === 'alpine', tz: false, users: { root: 0, nobody: 65534 }, homes: { 0: '/root' } }
  }
  if (['docker.io/library/debian', 'docker.io/library/ubuntu'].includes(ref.name)) {
    return { ...base, family: ref.short, user: '', workdir: '/', shell: 'dash', files: ['/bin/sh', '/bin/bash'], toolchain: false, libc: 'glibc', ca: false, tz: false, users: { root: 0, nobody: 65534 }, homes: { 0: '/root' } }
  }
  return { ...base, known: false, family: 'unknown', user: '', workdir: '/', shell: undefined, files: [], toolchain: undefined, users: { root: 0 }, homes: { 0: '/root' } }
}

/* ---------------------------------------------------------------------------------------------- */
/* POSIX shell reader for RUN steps and build scripts                                              */
/* ---------------------------------------------------------------------------------------------- */

/**
 * Splits shell source into simple commands. Each command has `assigns` (leading NAME=value),
 * `words` (raw text, quotes kept), `redirs` and the operator that follows it. Nested heredoc bodies
 * are attached to the redirect that opened them. Compound keywords (if/then/for/do...) are kept as
 * words; the evaluator treats them as transparent.
 */
export function splitShell(src) {
  const cmds = []
  let cur = newCmd()
  let i = 0
  const pendingHeredocs = []
  function newCmd() {
    return { assigns: [], words: [], redirs: [] }
  }
  function endCmd(op) {
    if (cur.words.length || cur.assigns.length || cur.redirs.length) {
      cur.op = op
      cmds.push(cur)
    }
    cur = newCmd()
  }
  function readWord() {
    let w = ''
    while (i < src.length) {
      const ch = src[i]
      if (ch === '\\') {
        if (src[i + 1] === '\n') {
          i += 2
          continue
        }
        w += ch + (src[i + 1] ?? '')
        i += 2
        continue
      }
      if (ch === "'") {
        const end = src.indexOf("'", i + 1)
        const e = end === -1 ? src.length : end
        w += src.slice(i, e + 1)
        i = e + 1
        continue
      }
      if (ch === '"') {
        let k = i + 1
        while (k < src.length && src[k] !== '"') {
          if (src[k] === '\\') k++
          else if (src[k] === '$' && src[k + 1] === '(') k = skipParens(src, k + 1)
          k++
        }
        w += src.slice(i, k + 1)
        i = k + 1
        continue
      }
      if (ch === '$' && src[i + 1] === '(') {
        const end = skipParens(src, i + 1)
        w += src.slice(i, end + 1)
        i = end + 1
        continue
      }
      if (ch === '$' && src[i + 1] === '{') {
        const end = matchBrace(src, i + 1)
        w += src.slice(i, end + 1)
        i = end + 1
        continue
      }
      if (ch === '`') {
        const end = src.indexOf('`', i + 1)
        const e = end === -1 ? src.length : end
        w += src.slice(i, e + 1)
        i = e + 1
        continue
      }
      if (ch === '(' && /^[A-Za-z_][A-Za-z0-9_]*\+?=$/.test(w)) {
        // bash array literal: name=(a b c)
        const end = skipParens(src, i)
        w += src.slice(i, end + 1)
        i = end + 1
        continue
      }
      if (/[\s;&|<>()]/.test(ch)) break
      w += ch
      i++
    }
    return w
  }
  while (i < src.length) {
    const ch = src[i]
    if (ch === '\\' && src[i + 1] === '\n') {
      i += 2
      continue
    }
    if (ch === '\n') {
      i++
      endCmd('\n')
      while (pendingHeredocs.length) {
        const h = pendingHeredocs.shift()
        let body = ''
        while (i < src.length) {
          const nl = src.indexOf('\n', i)
          const lineEnd = nl === -1 ? src.length : nl
          let line = src.slice(i, lineEnd)
          i = nl === -1 ? src.length : nl + 1
          if (h.chomp) line = line.replace(/^\t+/, '')
          if (line === h.delim) break
          body += `${line}\n`
        }
        h.redir.heredoc = { body, expand: h.expand }
      }
      continue
    }
    if (/\s/.test(ch)) {
      i++
      continue
    }
    if (ch === '#' ) {
      const nl = src.indexOf('\n', i)
      i = nl === -1 ? src.length : nl
      continue
    }
    const two = src.slice(i, i + 2)
    if (two === '&&' || two === '||') {
      i += 2
      endCmd(two)
      continue
    }
    if (ch === ';' || ch === '|' || ch === '&' || ch === '(' || ch === ')') {
      if (ch === '&' && src[i + 1] === '>') {
        // &> file
      } else {
        i++
        endCmd(ch)
        continue
      }
    }
    // redirections: [n]>, >>, <, <<, <<-, <<<, &>, n>&m
    const rm = /^(\d*|&)(>>|>&|>\||>|<<<|<<-|<<|<&|<>|<)/.exec(src.slice(i))
    if (rm && (rm[1] === '' || rm[1] === '&' || /^\d+$/.test(rm[1]))) {
      i += rm[0].length
      while (src[i] === ' ' || src[i] === '\t') i++
      const target = readWord()
      const redir = { fd: rm[1], op: rm[2], target }
      if (rm[2] === '<<' || rm[2] === '<<-') {
        const delim = target.replace(/["'\\]/g, '')
        pendingHeredocs.push({ redir, delim, chomp: rm[2] === '<<-', expand: !/["'\\]/.test(target) })
      }
      cur.redirs.push(redir)
      continue
    }
    const w = readWord()
    if (!w) {
      i++
      continue
    }
    const am = /^([A-Za-z_][A-Za-z0-9_]*)(\+?)=([\s\S]*)$/.exec(w)
    if (am && cur.words.length === 0) cur.assigns.push({ name: am[1], raw: am[3], append: am[2] === '+' })
    else cur.words.push(w)
  }
  endCmd(';')
  return cmds
}

function skipParens(s, open) {
  let depth = 0
  for (let k = open; k < s.length; k++) {
    const c = s[k]
    if (c === "'") {
      k = s.indexOf("'", k + 1)
      if (k === -1) return s.length - 1
    } else if (c === '"') {
      k++
      while (k < s.length && s[k] !== '"') {
        if (s[k] === '\\') k++
        k++
      }
    } else if (c === '(') depth++
    else if (c === ')') {
      depth--
      if (depth === 0) return k
    }
  }
  return s.length - 1
}

const SECRET_MARK = '\u0001'
/** Placeholder for a secret value inside evaluated strings. */
export const secretValue = (id) => `${SECRET_MARK}secret:${id}${SECRET_MARK}`
export const hasSecret = (s) => typeof s === 'string' && s.includes(SECRET_MARK)
export const secretsIn = (s) => [...String(s).matchAll(/\u0001secret:([^\u0001]*)\u0001/g)].map((m) => m[1])

/**
 * Evaluates a raw shell word: removes quotes, expands $VAR/${VAR...} from `env` and command
 * substitutions through `subst(innerSource)`. Unknown variables expand to ''.
 */
export function evalShellWord(raw, env, subst = () => '') {
  let out = ''
  let i = 0
  const vars = env
  const expandVar = () => {
    i++
    if (raw[i] === '(') {
      const end = skipParens(raw, i)
      const inner = raw.slice(i + 1, end)
      i = end + 1
      return subst(inner)
    }
    if (raw[i] === '{') {
      const end = matchBrace(raw, i)
      const inner = raw.slice(i + 1, end)
      i = end + 1
      const m = /^([A-Za-z_][A-Za-z0-9_]*|[0-9@*#?$!-])(.*)$/s.exec(inner)
      if (!m) return ''
      const [, name, mod] = m
      if (name === '#' && mod) return String((vars[mod] ?? '').length)
      if (!mod) return vars[name] ?? ''
      const mm = /^(:-|:\+|:\?|:=|-|\+|\?|=|##|#|%%|%)(.*)$/s.exec(mod)
      if (!mm) return vars[name] ?? ''
      const word = evalShellWord(mm[2], env, subst)
      const set = vars[name] !== undefined
      const val = vars[name] ?? ''
      switch (mm[1]) {
        case ':-':
        case ':=':
          return set && val !== '' ? val : word
        case '-':
        case '=':
          return set ? val : word
        case ':+':
          return set && val !== '' ? word : ''
        case '+':
          return set ? word : ''
        default:
          return val
      }
    }
    const m = /^([A-Za-z_][A-Za-z0-9_]*|[0-9@*#?$!-])/.exec(raw.slice(i))
    if (!m) return '$'
    i += m[0].length
    return vars[m[0]] ?? ''
  }
  while (i < raw.length) {
    const ch = raw[i]
    if (ch === "'") {
      const end = raw.indexOf("'", i + 1)
      out += raw.slice(i + 1, end === -1 ? raw.length : end)
      i = end === -1 ? raw.length : end + 1
    } else if (ch === '"') {
      i++
      while (i < raw.length && raw[i] !== '"') {
        if (raw[i] === '\\' && '"$`\\\n'.includes(raw[i + 1] ?? '')) {
          out += raw[i + 1] === '\n' ? '' : raw[i + 1]
          i += 2
        } else if (raw[i] === '$') out += expandVar()
        else if (raw[i] === '`') {
          const end = raw.indexOf('`', i + 1)
          out += subst(raw.slice(i + 1, end))
          i = end + 1
        } else out += raw[i++]
      }
      i++
    } else if (ch === '\\') {
      out += raw[i + 1] ?? ''
      i += 2
    } else if (ch === '$') out += expandVar()
    else if (ch === '`') {
      const end = raw.indexOf('`', i + 1)
      out += subst(raw.slice(i + 1, end === -1 ? raw.length : end))
      i = end === -1 ? raw.length : end + 1
    } else out += raw[i++]
  }
  return out
}

/* ---------------------------------------------------------------------------------------------- */
/* Build stage simulation                                                                          */
/* ---------------------------------------------------------------------------------------------- */

const absPath = (p, cwd) => cleanPath(p.startsWith('/') ? p : `${cwd}/${p}`)
const under = (path, dir) => dir === '/' || path === dir || path.startsWith(`${dir}/`)

/** filepath.Match-style glob (no `**`) for whole paths. */
function globRe(pattern) {
  let re = ''
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]
    if (c === '*') re += '[^/]*'
    else if (c === '?') re += '[^/]'
    else if (c === '[') {
      const end = pattern.indexOf(']', i + 1)
      if (end === -1) re += '\\['
      else {
        re += pattern.slice(i, end + 1).replace(/^\[!/, '[^').replace(/^\[\^/, '[^')
        i = end
      }
    } else if (c === '\\' && i + 1 < pattern.length) re += `\\${pattern[++i]}`
    else re += c.replace(/[.+^${}()|/]/g, '\\$&')
  }
  return new RegExp(`^${re}$`)
}

/** Lets callers say whether a generated directory (npm install, tsc output) contains a sub-path. */
let generatedHas = () => true

class FS {
  constructor(entries = new Map()) {
    this.entries = entries
  }
  clone() {
    return new FS(new Map([...this.entries].map(([k, v]) => [k, { ...v }])))
  }
  set(path, entry) {
    this.entries.set(cleanPath(path), entry)
  }
  get(path) {
    return this.entries.get(cleanPath(path))
  }
  /** A path exists if it was created, or a parent directory entry stands for its contents. */
  exists(path) {
    path = cleanPath(path)
    if (this.entries.has(path)) return true
    for (const k of this.entries.keys()) if (k.startsWith(`${path}/`)) return true
    const owner = this.owner(path)
    if (owner && owner.entry.type === 'dir' && owner.entry.generated)
      return generatedHas(owner.entry, path.slice(owner.path.length + 1))
    return false
  }
  isDir(path) {
    path = cleanPath(path)
    const e = this.entries.get(path)
    if (e) return e.type === 'dir'
    for (const k of this.entries.keys()) if (k.startsWith(`${path}/`)) return true
    return path === '/'
  }
  remove(path) {
    path = cleanPath(path)
    for (const k of [...this.entries.keys()]) if (under(k, path)) this.entries.delete(k)
  }
  subtree(path) {
    path = cleanPath(path)
    return [...this.entries].filter(([k]) => under(k, path))
  }
  /** Closest entry for a path: the path itself, or the nearest parent dir entry (e.g. node_modules). */
  owner(path) {
    path = cleanPath(path)
    let p = path
    for (;;) {
      const e = this.entries.get(p)
      if (e) return { path: p, entry: e }
      if (p === '/' || p === '.') return undefined
      p = posix.dirname(p)
    }
  }
}

/**
 * Simulates a build. Options:
 *   context: result of buildContext()
 *   buildArgs: { NAME: value } passed with --build-arg (values may contain secretValue() marks)
 *   secrets: { id: content | undefined } as the build command provides them
 *   target: stage name (default: last stage)
 *   tsOutDir: output directory of the project's TypeScript build (relative to the project root)
 */
export function simulate(dockerfileText, opts = {}) {
  const { context, buildArgs = {}, secrets = {}, target, tsOutDir = 'dist', taintedContext = new Set() } = opts
  generatedHas = opts.generatedHas ?? (() => true)
  const df = parseDockerfile(dockerfileText)
  const esc = df.escape
  const errors = []
  const stages = []
  const globalArgs = {}
  const predefined = {
    TARGETPLATFORM: 'linux/amd64', TARGETOS: 'linux', TARGETARCH: 'amd64', TARGETVARIANT: '',
    BUILDPLATFORM: 'linux/amd64', BUILDOS: 'linux', BUILDARCH: 'amd64', BUILDVARIANT: '',
  }
  let stage
  let instrIndex = 0

  const fail = (ins, msg) => errors.push({ line: ins?.line, message: msg })

  for (const ins of df.instructions) {
    instrIndex++
    if (ins.cmd === 'ARG' && !stage) {
      for (const w of parseWords(ins.rest, esc)) {
        const eq = w.indexOf('=')
        const name = eq === -1 ? w : w.slice(0, eq)
        const def = eq === -1 ? undefined : processWord(w.slice(eq + 1), { ...predefined, ...globalArgs }, esc)
        globalArgs[name] = Object.hasOwn(buildArgs, name) ? buildArgs[name] : def
      }
      continue
    }
    if (ins.cmd === 'FROM') {
      const words = ins.rest.split(/\s+/).filter(Boolean)
      const metaVars = Object.fromEntries(Object.entries({ ...predefined, ...globalArgs }).filter(([, v]) => v !== undefined))
      const baseName = processWord(words[0] ?? '', metaVars, esc)
      const name = words[1]?.toLowerCase() === 'as' ? words[2]?.toLowerCase() : undefined
      const parent = stages.find((s) => s.name && s.name === baseName.toLowerCase())
      const st = {
        index: stages.length,
        name,
        line: ins.line,
        fromText: words[0],
        baseRef: baseName,
        platform: flagValue(ins, 'platform'),
        parent,
        base: parent ? parent.base : describeBaseImage(baseName),
        instructions: [],
        runs: [],
        installs: [],
        builds: [],
        leaks: [],
        refs: new Set(),
        argScope: {},
        chainDeps: new Set(parent ? parent.chainDeps : []),
      }
      if (parent) {
        st.fs = parent.fs.clone()
        st.config = structuredClone(parent.config)
        st.users = { ...parent.users }
        st.homes = { ...parent.homes }
        st.toolchain = parent.toolchain
        st.packages = new Set(parent.packages)
      } else {
        const b = st.base
        st.fs = new FS()
        for (const f of b.files ?? []) st.fs.set(f, { type: 'file', origin: { kind: 'image', image: baseName }, deps: new Set() })
        st.config = {
          user: b.user ?? '',
          env: { ...(b.env ?? { PATH: DEFAULT_PATH }) },
          workdir: b.workdir ?? '/',
          entrypoint: b.entrypoint ?? null,
          cmd: b.cmd ?? null,
          healthcheck: b.healthcheck ?? null,
          shell: ['/bin/sh', '-c'],
          labels: {},
          expose: [],
          stopsignal: undefined,
        }
        if (!st.config.env.PATH) st.config.env.PATH = DEFAULT_PATH
        st.users = { ...(b.users ?? { root: 0 }) }
        st.homes = { ...(b.homes ?? { 0: '/root' }) }
        st.toolchain = b.toolchain
        st.packages = new Set()
      }
      st.cmdSetHere = false
      st.contextRead = (rel) => context.read(rel)
      stages.push(st)
      stage = st
      continue
    }
    if (!stage) {
      fail(ins, `${ins.cmd} before the first FROM`)
      continue
    }
    stage.instructions.push(ins)
    const vars = () => ({ ...stage.argScope, ...stage.config.env })
    switch (ins.cmd) {
      case 'ARG': {
        for (const w of parseWords(ins.rest, esc)) {
          const eq = w.indexOf('=')
          const name = eq === -1 ? w : w.slice(0, eq)
          let value
          if (Object.hasOwn(buildArgs, name)) value = buildArgs[name]
          else if (eq !== -1) value = processWord(w.slice(eq + 1), vars(), esc)
          else if (Object.hasOwn(globalArgs, name)) value = globalArgs[name]
          else if (Object.hasOwn(predefined, name)) value = predefined[name]
          stage.argScope[name] = value
          if (value !== undefined && Object.hasOwn(buildArgs, name)) stage.chainDeps.add(`build-arg:${name}`)
          ;(stage.args ??= []).push({ name, value, line: ins.line })
        }
        break
      }
      case 'ENV': {
        for (const [k, v] of parseKeyValues(ins, vars(), esc)) {
          if (v === undefined) continue
          stage.config.env[k] = v
          ;(stage.envs ??= []).push({ name: k, value: v, line: ins.line })
        }
        break
      }
      case 'LABEL':
        for (const [k, v] of parseKeyValues(ins, vars(), esc)) stage.config.labels[k] = v ?? ''
        break
      case 'WORKDIR': {
        const p = processWord(ins.rest, vars(), esc)
        stage.config.workdir = absPath(p, stage.config.workdir || '/')
        if (!stage.fs.exists(stage.config.workdir))
          stage.fs.set(stage.config.workdir, { type: 'dir', origin: { kind: 'workdir' }, deps: new Set(), owner: 'root' })
        break
      }
      case 'USER':
        stage.config.user = processWord(ins.rest, vars(), esc)
        break
      case 'EXPOSE':
        stage.config.expose.push(...ins.rest.split(/\s+/).filter(Boolean).map((p) => processWord(p, vars(), esc)))
        break
      case 'STOPSIGNAL':
        stage.config.stopsignal = processWord(ins.rest, vars(), esc)
        break
      case 'SHELL':
        if (ins.json) stage.config.shell = ins.json
        else fail(ins, 'SHELL requires the JSON form')
        break
      case 'ENTRYPOINT':
        stage.config.entrypoint = ins.json ? ins.json : [...stage.config.shell, ins.rest]
        stage.config.entrypointForm = ins.json ? 'exec' : 'shell'
        if (!stage.cmdSetHere) stage.config.cmd = null
        break
      case 'CMD':
        stage.config.cmd = ins.json ? ins.json : [...stage.config.shell, ins.rest]
        stage.config.cmdForm = ins.json ? 'exec' : 'shell'
        stage.cmdSetHere = true
        break
      case 'HEALTHCHECK': {
        if (ins.healthType === 'NONE') stage.config.healthcheck = { test: ['NONE'] }
        else if (ins.healthType === 'CMD') {
          const test = ins.json ? ['CMD', ...ins.json] : ['CMD-SHELL', ins.healthRest]
          const opt = (n) => flagValue(ins, n)
          stage.config.healthcheck = { test, interval: opt('interval'), timeout: opt('timeout'), startPeriod: opt('start-period'), startInterval: opt('start-interval'), retries: opt('retries') }
        } else fail(ins, `HEALTHCHECK expects CMD or NONE, got "${ins.healthType}"`)
        break
      }
      case 'COPY':
      case 'ADD':
        doCopy(stage, ins)
        break
      case 'RUN':
        doRun(stage, ins)
        break
      case 'VOLUME':
      case 'ONBUILD':
      case 'MAINTAINER':
        break
      default:
        fail(ins, `unknown instruction ${ins.cmd}`)
    }
  }

  function stageByRef(ref) {
    const r = ref.toLowerCase()
    if (/^\d+$/.test(r)) return stages[Number(r)]
    return stages.find((s) => s.name === r)
  }

  function contextMatches(src) {
    const s = cleanPath(src.replace(/^\/+/, '') || '.')
    if (s === '.') return { kind: 'root', files: context.files }
    if (/[*?[]/.test(s)) {
      const re = globRe(s)
      const hits = new Set()
      for (const f of context.files) {
        const parts = f.split('/')
        for (let d = 1; d <= parts.length; d++) {
          const p = parts.slice(0, d).join('/')
          if (re.test(p)) hits.add(p)
        }
      }
      return { kind: 'glob', hits: [...hits] }
    }
    if (context.files.includes(s)) return { kind: 'file', path: s }
    if (context.files.some((f) => f.startsWith(`${s}/`))) return { kind: 'dir', path: s }
    return { kind: 'missing', path: s }
  }

  function noteTaint(stage, ins, rel, to) {
    if (taintedContext.has(rel)) stage.leaks.push({ line: ins.line, path: to, how: `${ins.cmd} ${rel} from the build context` })
  }

  function copyContextPath(stage, rel, dest, destIsDir, deps, ins, extra) {
    const isDir = context.files.some((f) => f.startsWith(`${rel}/`)) && !context.files.includes(rel)
    if (isDir) {
      for (const f of context.files.filter((x) => x.startsWith(`${rel}/`))) {
        const to = cleanPath(`${dest}/${f.slice(rel.length + 1)}`)
        stage.fs.set(to, { type: 'file', origin: { kind: 'context', rel: f }, deps: new Set([f]), ...extra })
        noteTaint(stage, ins, f, to)
        deps.add(f)
      }
      return
    }
    const to = destIsDir ? cleanPath(`${dest}/${posix.basename(rel)}`) : dest
    stage.fs.set(to, { type: 'file', origin: { kind: 'context', rel }, deps: new Set([rel]), ...extra })
    noteTaint(stage, ins, rel, to)
    deps.add(rel)
  }

  function doCopy(stage, ins) {
    const vars = { ...stage.argScope, ...stage.config.env }
    const from = flagValue(ins, 'from')
    const chown = flagValue(ins, 'chown')
    const extra = chown ? { chown: processWord(chown, vars, esc) } : {}
    let args = ins.json ?? ins.rest.split(/\s+/).filter(Boolean)
    if (ins.heredocs.length) {
      const destRaw = args.at(-1)
      const dest = absPath(processWord(destRaw, vars, esc), stage.config.workdir)
      for (const h of ins.heredocs) {
        const to = ins.heredocs.length > 1 || destRaw.endsWith('/') ? `${dest}/${h.name}` : dest
        stage.fs.set(to, { type: 'file', origin: { kind: 'heredoc', content: h.content }, content: h.content, deps: new Set(), ...extra })
      }
      stage.chainDeps = new Set([...stage.chainDeps])
      return
    }
    args = args.map((a) => processWord(a, vars, esc))
    if (args.length < 2) return fail(ins, `${ins.cmd} requires at least two arguments`)
    const destRaw = args.at(-1)
    const sources = args.slice(0, -1)
    const dest = absPath(destRaw, stage.config.workdir)
    const destIsDir = destRaw.endsWith('/') || sources.length > 1 || stage.fs.isDir(dest) || /[*?[]/.test(sources.join(''))
    const deps = new Set()
    const excludes = flagValues(ins, 'exclude').map((p) => new IgnoreMatcher([p]))
    if (from) {
      const src = stageByRef(from)
      if (!src) {
        // An external image: contents unknown, record what was asked for.
        for (const s of sources) {
          const to = destIsDir ? cleanPath(`${dest}/${posix.basename(s)}`) : dest
          stage.fs.set(to, { type: 'file', origin: { kind: 'image', image: from, path: s }, deps: new Set(), ...extra })
        }
        stage.chainDeps.add(`image:${from}`)
        return
      }
      for (const s of sources) {
        const sp = absPath(s, '/')
        const entries = src.fs.subtree(sp)
        const owner = entries.length ? undefined : src.fs.owner(sp)
        if (!entries.length && !(owner && owner.entry.type === 'dir' && owner.entry.generated)) {
          fail(ins, `${ins.cmd} --from=${from} ${s}: not found in stage "${src.name ?? src.index}"`)
          continue
        }
        if (!entries.length && owner) {
          // Path inside a generated directory (e.g. node_modules/.bin): copy the owner's metadata.
          const to = destIsDir ? cleanPath(`${dest}/${posix.basename(sp)}`) : dest
          stage.fs.set(to, { ...owner.entry, deps: new Set(owner.entry.deps), ...extra })
          for (const d of owner.entry.deps) deps.add(d)
          continue
        }
        const single = entries.length === 1 && entries[0][0] === sp && entries[0][1].type === 'file'
        for (const [p, e] of entries) {
          if (excludes.some((m) => m.matches(p.slice(sp.length + 1)))) continue
          let to
          if (single) to = destIsDir ? cleanPath(`${dest}/${posix.basename(sp)}`) : dest
          else to = cleanPath(`${dest}/${p.slice(sp === '/' ? 1 : sp.length + 1)}`)
          stage.fs.set(to, { ...e, deps: new Set(e.deps), ...extra })
          for (const d of e.deps) deps.add(d)
        }
      }
    } else {
      for (const s of sources) {
        if (/^https?:\/\//.test(s) || /^git@/.test(s)) {
          const to = destIsDir ? cleanPath(`${dest}/${posix.basename(s)}`) : dest
          stage.fs.set(to, { type: 'file', origin: { kind: 'url', url: s }, deps: new Set([`url:${s}`]), ...extra })
          deps.add(`url:${s}`)
          continue
        }
        const m = contextMatches(s)
        if (m.kind === 'missing') {
          fail(ins, `${ins.cmd} ${s}: not found in the build context${context.all.includes(m.path) || context.all.some((f) => f.startsWith(`${m.path}/`)) ? ' (excluded by .dockerignore)' : ''}`)
          continue
        }
        if (m.kind === 'root') {
          for (const f of m.files) {
            if (excludes.some((x) => x.matches(f))) continue
            stage.fs.set(cleanPath(`${dest}/${f}`), { type: 'file', origin: { kind: 'context', rel: f }, deps: new Set([f]), ...extra })
            noteTaint(stage, ins, f, cleanPath(`${dest}/${f}`))
            deps.add(f)
          }
        } else if (m.kind === 'glob') {
          for (const h of m.hits) copyContextPath(stage, h, dest, true, deps, ins, extra)
        } else copyContextPath(stage, m.path, dest, destIsDir, deps, ins, extra)
      }
    }
    for (const d of deps) stage.chainDeps.add(d)
    if (from && stageByRef(from)) stage.refs.add(stageByRef(from))
  }

  /* ------------------------------------------------------------------ RUN */

  function doRun(stage, ins) {
    const vars = { ...stage.argScope, ...stage.config.env }
    const mounts = flagValues(ins, 'mount').map((m) => parseMount(processWord(m, vars, esc)))
    const runEnv = {}
    for (const [k, v] of Object.entries(stage.argScope)) if (v !== undefined) runEnv[k] = v
    Object.assign(runEnv, stage.config.env)
    const workdir = stage.config.workdir || '/'
    const record = { line: ins.line, ins, mounts, inputs: new Set(), writes: [], secretsUsed: new Set(), stage }
    const overlay = new Map() // mount target -> entry visible only during this RUN
    for (const m of mounts) {
      if (m.type === 'secret') {
        const id = m.id ?? (m.source || (m.target ? posix.basename(m.target) : undefined))
        const provided = Object.hasOwn(secrets, id) ? secrets[id] : undefined
        record.secretsUsed.add(id)
        if (m.env) {
          if (provided !== undefined) runEnv[m.env] = provided
        }
        if (!m.env || m.target) {
          const target = absPath(m.target ?? `/run/secrets/${posix.basename(id)}`, workdir)
          if (provided !== undefined)
            overlay.set(target, { type: 'file', origin: { kind: 'secret', id }, content: provided, mode: m.mode ?? 0o400, uid: m.uid ?? 0, gid: m.gid ?? 0, deps: new Set() })
        }
        if (provided === undefined && m.required) fail(ins, `secret ${id}: not found`)
        if (provided === undefined) record.missingSecrets = [...(record.missingSecrets ?? []), id]
      } else if (m.type === 'bind') {
        const target = absPath(m.target ?? '/', workdir)
        if (m.from) {
          const src = stageByRef(m.from)
          const sp = absPath(m.source ?? '/', '/')
          if (src) {
            stage.refs.add(src)
            for (const [p, e] of src.fs.subtree(sp)) overlay.set(cleanPath(`${target}/${p.slice(sp === '/' ? 1 : sp.length + 1)}`), e)
            for (const [, e] of src.fs.subtree(sp)) for (const d of e.deps) record.inputs.add(d)
          }
        } else {
          const s = cleanPath((m.source ?? '.').replace(/^\/+/, '') || '.')
          const files = s === '.' ? context.files : context.files.filter((f) => f === s || f.startsWith(`${s}/`))
          if (!files.length) fail(ins, `RUN --mount=type=bind,source=${m.source}: not found in the build context`)
          for (const f of files) {
            const to = s === '.' ? `${target}/${f}` : f === s ? target : `${target}/${f.slice(s.length + 1)}`
            overlay.set(cleanPath(to), { type: 'file', origin: { kind: 'context', rel: f }, deps: new Set([f]) })
            record.inputs.add(f)
          }
        }
      } else if (m.type === 'cache' || m.type === 'tmpfs') {
        overlay.set(absPath(m.target ?? '/', workdir), { type: 'dir', origin: { kind: m.type }, deps: new Set(), volatile: true })
      }
    }
    for (const d of record.inputs) stage.chainDeps.add(d)
    record.deps = new Set(stage.chainDeps)
    let script
    if (ins.json) {
      const isShell = ins.json.length >= 3 && /(^|\/)(ba|da|a)?sh$/.test(ins.json[0]) && ins.json[1] === '-c'
      script = isShell ? ins.json[2] : ins.json.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(' ')
    } else if (ins.heredocs.length) {
      // `RUN <<EOF` runs the heredoc as the script; `RUN bash <<EOF` feeds it to a shell; any other
      // command gets it on stdin.
      const words = parseWords(ins.rest).filter((w) => !/^\d*<<-?/.test(w))
      if (!words.length || /^(\/(usr\/)?bin\/)?(ba|da|a)?sh$/.test(words[0])) script = ins.heredocs.map((h) => h.content).join('\n')
      else script = ins.rest
    } else script = ins.rest
    record.script = ins.heredocs.length ? `${ins.rest}\n${ins.heredocs.map((h) => h.content).join('\n')}` : script
    const user = stage.config.user || ''
    const shellCtx = new RunContext({ stage, record, env: runEnv, cwd: workdir, overlay, user, tsOutDir, fail: (m) => fail(ins, m) })
    shellCtx.run(script)
    shellCtx.finish()
    stage.runs.push(record)
  }

  const targetStage = target ? stageByRef(target) : stages.at(-1)
  if (target && !targetStage) errors.push({ message: `target stage "${target}" does not exist` })
  return { df, stages, final: targetStage, errors, globalArgs }
}

export function parseMount(spec) {
  const m = { type: 'bind' }
  for (const field of spec.split(',')) {
    const eq = field.indexOf('=')
    const k = (eq === -1 ? field : field.slice(0, eq)).trim().toLowerCase()
    const v = eq === -1 ? undefined : field.slice(eq + 1).trim()
    if (k === 'type') m.type = v.toLowerCase()
    else if (k === 'id') m.id = v
    else if (k === 'source' || k === 'src') m.source = v
    else if (k === 'target' || k === 'dst' || k === 'destination') m.target = v
    else if (k === 'from') m.from = v
    else if (k === 'env') m.env = v
    else if (k === 'required') m.required = v === undefined || v === 'true'
    else if (k === 'mode') m.mode = Number.parseInt(v, 8)
    else if (k === 'uid') m.uid = Number(v)
    else if (k === 'gid') m.gid = Number(v)
    else if (k === 'readonly' || k === 'ro') m.readonly = v === undefined || v === 'true'
    else if (k === 'readwrite' || k === 'rw') m.readonly = !(v === undefined || v === 'true')
  }
  if (m.type === 'secret' && m.source && !m.id) m.id = m.source
  return m
}

/* ---------------------------------------------------------------------------------------------- */
/* Interpreting the commands of one RUN step                                                       */
/* ---------------------------------------------------------------------------------------------- */

const NPM_INSTALL = new Set(['ci', 'clean-install', 'ic', 'install-clean', 'isntall-clean', 'install', 'i', 'in', 'ins', 'inst', 'insta', 'instal', 'isnt', 'isnta', 'isntal', 'isntall', 'add', 'it', 'install-test', 'cit', 'install-ci-test', 'clean-install-test', 'sit'])
const APT_TOOLS = { curl: ['/usr/bin/curl'], wget: ['/usr/bin/wget'], tini: ['/usr/bin/tini', '/sbin/tini'], 'dumb-init': ['/usr/bin/dumb-init'], 'ca-certificates': ['/etc/ssl/certs/ca-certificates.crt'], tzdata: ['/usr/share/zoneinfo/Europe/Lisbon'], busybox: ['/bin/busybox'], netcat: ['/bin/nc'], 'netcat-openbsd': ['/bin/nc'] }
const TOOLCHAIN_PKGS = /^(build-essential|build-base|gcc|g\+\+|make|clang|python3?|python3-dev|git|musl-dev|libc6-dev|golang|go|nodejs-dev)$/

class RunContext {
  constructor({ stage, record, env, cwd, overlay, user, tsOutDir, fail }) {
    Object.assign(this, { stage, record, env, cwd, overlay, user, tsOutDir, fail })
    this.created = new Map() // path -> entry written during this RUN
  }

  uid() {
    const u = String(this.user || '').split(':')[0]
    if (u === '') return 0
    if (/^\d+$/.test(u)) return Number(u)
    return this.stage.users[u] ?? -1
  }
  home() {
    if (this.env.HOME) return this.env.HOME
    const uid = this.uid()
    return this.stage.homes[uid] ?? (uid === 0 ? '/root' : '/')
  }

  /** File lookup during this RUN: mounts shadow the image filesystem. */
  file(path) {
    const p = cleanPath(path)
    if (this.overlay.has(p)) return this.overlay.get(p)
    if (this.created.has(p)) return this.created.get(p)
    return this.stage.fs.get(p)
  }
  exists(path) {
    const p = cleanPath(path)
    if (this.overlay.has(p) || this.created.has(p)) return true
    for (const k of this.overlay.keys()) if (k.startsWith(`${p}/`)) return true
    return this.stage.fs.exists(p)
  }
  readable(entry) {
    if (!entry) return false
    if (entry.origin?.kind !== 'secret') return true
    const uid = this.uid()
    if (uid === 0) return true
    if (uid === entry.uid) return ((entry.mode ?? 0o400) & 0o400) !== 0
    if (uid === -1) return ((entry.mode ?? 0o400) & 0o004) !== 0
    return ((entry.mode ?? 0o400) & 0o004) !== 0
  }
  content(path) {
    const e = this.file(path)
    if (!e) return undefined
    if (!this.readable(e)) return { unreadable: true }
    if (e.content !== undefined) return e.content
    if (e.origin?.kind === 'context' && this.stage.contextRead) return this.stage.contextRead(e.origin.rel)
    return e.readContent?.()
  }

  subst(inner, env) {
    const cmds = splitShell(inner)
    if (cmds.length === 1) {
      const c = cmds[0]
      const words = c.words.map((w) => evalShellWord(w, env, (x) => this.subst(x, env)))
      const inRedir = c.redirs.find((r) => r.op === '<')
      if ((words[0] === 'cat' && words.length === 2) || (!words.length && inRedir)) {
        const p = absPath(words[1] ?? evalShellWord(inRedir.target, env), this.cwd)
        const c2 = this.content(p)
        if (c2 && typeof c2 === 'object' && c2.unreadable) {
          this.record.unreadable = [...(this.record.unreadable ?? []), p]
          return ''
        }
        return typeof c2 === 'string' ? c2.replace(/\n+$/, '') : ''
      }
      if (words[0] === 'mktemp') return `/tmp/tmp.${Math.random().toString(36).slice(2, 10)}`
    }
    return ''
  }

  ev(raw, env = this.env) {
    return evalShellWord(raw, env, (inner) => this.subst(inner, env))
  }

  write(path, content, how) {
    const p = absPath(path, this.cwd)
    const entry = { type: 'file', origin: { kind: 'run', how }, content, deps: this.record.deps }
    this.created.set(p, entry)
    this.record.writes.push({ path: p, how, secret: hasSecret(content) })
  }
  remove(path) {
    const p = absPath(path, this.cwd)
    for (const k of [...this.created.keys()]) if (under(k, p)) this.created.delete(k)
    this.stage.fs.remove(p)
  }

  run(script) {
    const cmds = splitShell(script)
    const env = this.env
    for (const c of cmds) {
      const localEnv = { ...env }
      for (const a of c.assigns) localEnv[a.name] = this.ev(a.raw, localEnv)
      if (!c.words.length) {
        Object.assign(env, localEnv)
        this.redirect(c, '', localEnv)
        continue
      }
      let words = c.words.map((w) => this.ev(w, localEnv))
      // Transparent prefixes and compound keywords.
      while (words.length && ['then', 'do', 'else', 'elif', 'if', 'while', 'until', '!', '{', '}', 'time', 'sudo', 'exec', 'command', 'nice', 'nohup'].includes(words[0])) words = words.slice(1)
      if (words[0] === 'env') {
        words = words.slice(1)
        while (words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) {
          const [k, ...v] = words.shift().split('=')
          localEnv[k] = v.join('=')
        }
      }
      if (!words.length) continue
      this.command(words, localEnv, c, env)
    }
  }

  redirect(c, content, env) {
    for (const r of c.redirs) {
      if (r.op === '>' || r.op === '>>' || r.op === '>|') {
        const target = this.ev(r.target, env)
        if (r.fd === '2' || target === '/dev/null' || target.startsWith('&')) continue
        const prev = r.op === '>>' ? this.content(absPath(target, this.cwd)) : ''
        const body = c.redirs.find((x) => x.heredoc)?.heredoc
        const text = body ? (body.expand ? this.ev(`"${body.body.replace(/"/g, '\\"')}"`, env) : body.body) : content
        this.write(target, `${typeof prev === 'string' ? prev : ''}${text}`, `${r.op} ${target}`)
      }
    }
  }

  command(words, env, c, outerEnv) {
    const [cmd0, ...args] = words
    const cmd = posix.basename(cmd0)
    const st = this.stage
    switch (cmd) {
      case 'export':
        for (const a of args) {
          const eq = a.indexOf('=')
          if (eq !== -1) outerEnv[a.slice(0, eq)] = a.slice(eq + 1)
          else if (env[a] !== undefined) outerEnv[a] = env[a]
        }
        return
      case 'unset':
        for (const a of args) delete outerEnv[a]
        return
      case 'cd':
        this.cwd = absPath(args[0] ?? this.home(), this.cwd)
        return
      case 'echo':
      case 'printf': {
        let text
        if (cmd === 'echo') {
          const a = [...args]
          while (a[0] && /^-[neE]+$/.test(a[0])) a.shift()
          text = `${a.join(' ')}\n`
        } else {
          const [fmt = '', ...rest] = args
          let k = 0
          text = fmt.replace(/%[sdb%]/g, (m) => (m === '%%' ? '%' : (rest[k++] ?? ''))).replace(/\\n/g, '\n')
          if (k < rest.length) text += rest.slice(k).join('')
        }
        this.redirect(c, text, env)
        return
      }
      case 'cat': {
        const files = args.filter((a) => !a.startsWith('-'))
        let text = ''
        for (const f of files) {
          const v = this.content(absPath(f, this.cwd))
          if (v && typeof v === 'object') this.record.unreadable = [...(this.record.unreadable ?? []), f]
          else text += v ?? ''
        }
        const body = c.redirs.find((x) => x.heredoc)?.heredoc
        if (!files.length && body) text = body.expand ? this.ev(`"${body.body.replace(/"/g, '\\"')}"`, env) : body.body
        this.redirect(c, text, env)
        return
      }
      case 'tee': {
        const files = args.filter((a) => !a.startsWith('-'))
        const body = c.redirs.find((x) => x.heredoc)?.heredoc
        const text = body ? (body.expand ? this.ev(`"${body.body.replace(/"/g, '\\"')}"`, env) : body.body) : (this.lastOutput ?? '')
        for (const f of files) this.write(f, text, `tee ${f}`)
        return
      }
      case 'cp':
      case 'install':
      case 'mv': {
        const plain = args.filter((a) => !a.startsWith('-'))
        if (plain.length < 2) return
        const dst = absPath(plain.at(-1), this.cwd)
        for (const s of plain.slice(0, -1)) {
          const sp = absPath(s, this.cwd)
          const e = this.file(sp)
          const tree = this.stage.fs.subtree(sp)
          const to = this.exists(dst) && (this.file(dst)?.type === 'dir' || this.stage.fs.isDir(dst)) ? cleanPath(`${dst}/${posix.basename(sp)}`) : dst
          if (e && e.type === 'file') {
            const content = this.readable(e) ? (e.content ?? this.content(sp)) : undefined
            this.created.set(to, { ...e, origin: { kind: 'run', how: `${cmd} ${s}` }, content, deps: this.record.deps })
            this.record.writes.push({ path: to, how: `${cmd} ${s}`, secret: hasSecret(content) })
          } else {
            for (const [p, te] of tree) this.created.set(cleanPath(`${to}/${p.slice(sp.length + 1)}`), { ...te })
          }
          if (cmd === 'mv') this.remove(sp)
        }
        return
      }
      case 'rm': {
        for (const a of args.filter((x) => !x.startsWith('-'))) {
          if (/[*?[]/.test(a)) {
            const re = globRe(absPath(a, this.cwd))
            for (const k of [...this.created.keys(), ...this.stage.fs.entries.keys()]) if (re.test(k)) this.remove(k)
          } else this.remove(a)
        }
        return
      }
      case 'mkdir':
        for (const a of args.filter((x) => !x.startsWith('-'))) {
          const p = absPath(a, this.cwd)
          if (!this.exists(p)) this.created.set(p, { type: 'dir', origin: { kind: 'run', how: 'mkdir' }, deps: this.record.deps })
        }
        return
      case 'touch':
        for (const a of args.filter((x) => !x.startsWith('-'))) this.write(a, '', 'touch')
        return
      case 'ln': {
        const plain = args.filter((a) => !a.startsWith('-'))
        if (plain.length === 2) this.created.set(absPath(plain[1], this.cwd), { type: 'file', origin: { kind: 'run', how: `ln ${plain[0]}` }, link: plain[0], deps: this.record.deps })
        return
      }
      case 'apt-get':
      case 'apt':
      case 'apk':
      case 'microdnf':
      case 'dnf':
      case 'yum': {
        const sub = args.find((a) => !a.startsWith('-'))
        if (!['install', 'add'].includes(sub)) {
          if (['purge', 'remove', 'del', 'autoremove'].includes(sub)) {
            for (const p of args.slice(args.indexOf(sub) + 1).filter((a) => !a.startsWith('-'))) {
              const name = p.split('=')[0]
              for (const f of APT_TOOLS[name] ?? []) this.remove(f)
              st.packages.delete(name)
            }
            if (args.some((a) => TOOLCHAIN_PKGS.test(a))) st.toolchainRemoved = true
          }
          return
        }
        const pkgs = args.slice(args.indexOf(sub) + 1).filter((a) => !a.startsWith('-')).map((p) => p.split(/[=<>]/)[0])
        for (const p of pkgs) {
          st.packages.add(p)
          for (const f of APT_TOOLS[p] ?? []) this.created.set(f, { type: 'file', origin: { kind: 'package', name: p }, deps: this.record.deps })
          if (TOOLCHAIN_PKGS.test(p)) st.installedToolchain = [...(st.installedToolchain ?? []), p]
        }
        return
      }
      case 'useradd':
      case 'adduser':
      case 'groupadd':
      case 'addgroup': {
        let uid
        const plain = []
        for (let k = 0; k < args.length; k++) {
          const a = args[k]
          if (a === '-u' || a === '--uid' || a === '-g' || a === '--gid') {
            if (cmd.includes('user') && (a === '-u' || a === '--uid')) uid = Number(args[++k])
            else if (cmd.includes('group') && (a === '-g' || a === '--gid')) uid = Number(args[++k])
            else k++
          } else if (/^--uid=/.test(a)) uid = Number(a.split('=')[1])
          else if (/^-[GgsdmcDhkKpe]$|^--(shell|home|home-dir|gecos|ingroup|group|system|disabled-password|disabled-login|no-create-home|create-home|comment)$/.test(a)) {
            if (/^-[GgsdckKpe]$|^--(shell|home|home-dir|gecos|ingroup|group|comment)$/.test(a)) k++
          } else if (!a.startsWith('-')) plain.push(a)
        }
        const name = cmd === 'adduser' || cmd === 'addgroup' ? plain[0] : plain.at(-1)
        if (cmd.includes('user') && name) {
          st.users[name] = uid ?? 1001
          st.homes[uid ?? 1001] = `/home/${name}`
        }
        return
      }
      case 'npm':
        return this.npm(args, env, c)
      case 'npx':
      case 'tsc':
        if (cmd === 'tsc' || args.find((a) => !a.startsWith('-')) === 'tsc') return this.tsBuild(env)
        return
      case 'node':
        return
      case 'corepack':
      case 'yarn':
      case 'pnpm':
        this.record.otherPm = cmd
        return
      default:
        if (/node_modules\/\.bin\/tsc$/.test(cmd0)) return this.tsBuild(env)
    }
  }

  /** npm's config files for this process, in precedence order (cli, env, project, user, global). */
  npmConfig(args, env) {
    const cli = {}
    for (const a of args) {
      const m = /^--([^=]+)=(.*)$/.exec(a)
      if (m) cli[m[1]] = m[2]
    }
    const projectDir = this.cwd
    const userconfig = cli.userconfig ?? env.NPM_CONFIG_USERCONFIG ?? env.npm_config_userconfig ?? `${this.home()}/.npmrc`
    const globalconfig = cli.globalconfig ?? env.NPM_CONFIG_GLOBALCONFIG ?? env.npm_config_globalconfig ?? '/usr/local/etc/npmrc'
    const sources = [{ name: 'command line', kv: cli }]
    for (const [name, path] of [['project', `${projectDir}/.npmrc`], ['user', userconfig], ['global', globalconfig]]) {
      const p = absPath(path, this.cwd)
      const e = this.file(p)
      if (!e) continue
      const c = this.content(p)
      if (c && typeof c === 'object') {
        sources.push({ name, path: p, unreadable: true, kv: {} })
        continue
      }
      sources.push({ name, path: p, kv: parseIni(c ?? ''), entry: e })
    }
    const get = (key) => {
      for (const s of sources) if (Object.hasOwn(s.kv, key)) return { value: expandNpmEnv(s.kv[key], env), source: s }
      return undefined
    }
    return { sources, get }
  }

  npm(args, env, c) {
    const sub = args.find((a) => !a.startsWith('-'))
    const subIdx = args.indexOf(sub)
    const rest = args.slice(subIdx + 1)
    const has = (f) => args.includes(f)
    const st = this.stage
    if (sub === 'config' || sub === 'c') {
      const action = rest[0]
      if (action === 'set') {
        let loc = 'user'
        const flagLoc = args.find((a) => a.startsWith('--location='))?.split('=')[1] ?? (args.includes('-L') ? args[args.indexOf('-L') + 1] : undefined)
        if (flagLoc) loc = flagLoc
        if (args.includes('-g') || args.includes('--global')) loc = 'global'
        const kvs = rest.slice(1).filter((a) => !a.startsWith('-') && a !== flagLoc)
        const pairs = []
        for (let k = 0; k < kvs.length; k++) {
          if (kvs[k].includes('=')) pairs.push(kvs[k])
          else if (kvs[k + 1] !== undefined) pairs.push(`${kvs[k]}=${kvs[++k]}`)
        }
        const cfg = this.npmConfig(args, env)
        const path = loc === 'project' ? `${this.cwd}/.npmrc` : loc === 'global' ? '/usr/local/etc/npmrc' : (cfg.sources.find((s) => s.name === 'user')?.path ?? `${this.home()}/.npmrc`)
        const prev = this.content(path)
        this.write(path, `${typeof prev === 'string' ? prev : ''}${pairs.join('\n')}\n`, `npm config set (${loc} config ${path})`)
      }
      return
    }
    if (sub === 'prune') {
      const nm = `${this.cwd}/node_modules`
      const e = this.file(nm)
      if (e && (has('--omit=dev') || has('--production') || (args.includes('--omit') && args[args.indexOf('--omit') + 1] === 'dev') || env.NODE_ENV === 'production' || has('--only=prod') || has('--only=production')))
        this.created.set(cleanPath(nm), { ...e, dev: false, how: `${e.how}, pruned`, deps: this.record.deps })
      return
    }
    if (sub === 'run' || sub === 'run-script' || sub === 'rum' || sub === 'urn') {
      const script = rest.find((a) => !a.startsWith('-'))
      const pkg = this.packageJson()
      const body = pkg?.scripts?.[script]
      if (!body) {
        this.fail(`npm run ${script}: no such script in package.json at ${this.cwd}`)
        return
      }
      if (/\btsc\b/.test(body)) return this.tsBuild(env)
      return
    }
    if (sub === 'test' || sub === 't' || sub === 'start' || sub === 'cache' || sub === 'rebuild' || sub === 'audit') return
    if (!NPM_INSTALL.has(sub)) return
    if (has('-g') || has('--global') || has('--location=global')) return
    const positional = rest.filter((a) => !a.startsWith('-'))
    if (sub !== 'ci' && sub !== 'clean-install' && positional.length) return
    const pkg = this.packageJson()
    if (!pkg) {
      this.fail(`npm ${sub} runs in ${this.cwd}, which has no package.json at that point`)
      return
    }
    const lock = this.exists(`${this.cwd}/package-lock.json`) || this.exists(`${this.cwd}/npm-shrinkwrap.json`)
    if (['ci', 'clean-install', 'ic', 'install-clean', 'cit', 'install-ci-test'].includes(sub) && !lock) {
      this.fail(`npm ${sub} needs package-lock.json in ${this.cwd}, which is not there at that point`)
      return
    }
    const omitVals = []
    args.forEach((a, k) => {
      if (a.startsWith('--omit=')) omitVals.push(a.slice(7))
      if (a === '--omit' && args[k + 1]) omitVals.push(args[k + 1])
    })
    const includeDev = args.some((a, k) => a === '--include=dev' || (a === '--include' && args[k + 1] === 'dev')) || has('--production=false')
    let omitDev =
      omitVals.includes('dev') ||
      has('--production') ||
      has('--production=true') ||
      has('--only=prod') ||
      has('--only=production') ||
      /(^|,)dev(,|$)/.test(env.NPM_CONFIG_OMIT ?? env.npm_config_omit ?? '') ||
      /^(true|1)$/.test(env.NPM_CONFIG_PRODUCTION ?? env.npm_config_production ?? '') ||
      (!omitVals.length && env.NODE_ENV === 'production')
    if (includeDev) omitDev = false
    const auth = this.npmAuth(args, env, pkg)
    const nm = cleanPath(`${this.cwd}/node_modules`)
    const entry = { type: 'dir', generated: true, origin: { kind: 'npm', how: `npm ${sub}` }, npm: true, dev: !omitDev, how: `npm ${sub}${omitDev ? ' (no devDependencies)' : ' (with devDependencies)'}`, auth, deps: this.record.deps, line: this.record.line, record: this.record, user: this.user }
    this.stage.fs.remove(nm)
    this.created.set(nm, entry)
    st.installs.push({ line: this.record.line, path: nm, dev: !omitDev, auth, record: this.record, deps: this.record.deps, user: this.user })
  }

  packageJson() {
    const c = this.content(`${this.cwd}/package.json`)
    if (typeof c !== 'string') return this.exists(`${this.cwd}/package.json`) ? {} : undefined
    try {
      return JSON.parse(c)
    } catch {
      return {}
    }
  }

  /** Whether npm in this process can authenticate to each private scope's registry. */
  npmAuth(args, env, pkg) {
    const cfg = this.npmConfig(args, env)
    const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.optionalDependencies ?? {}) }
    const scopes = [...new Set(Object.keys({ ...deps, ...(pkg?.devDependencies ?? {}) }).filter((n) => n.startsWith('@')).map((n) => n.split('/')[0]))]
    const out = []
    for (const scope of scopes) {
      const reg = cfg.get(`${scope}:registry`)
      if (!reg) continue
      let url
      try {
        url = new URL(reg.value)
      } catch {
        continue
      }
      const nerf = `//${url.host}${url.pathname.replace(/\/?$/, '/')}`
      const tokenKeys = [`${nerf}:_authToken`, `//${url.host}/:_authToken`, `${nerf}:_auth`, `//${url.host}/:_auth`]
      let token
      for (const k of tokenKeys) {
        token = cfg.get(k)
        if (token) break
      }
      const unreadable = cfg.sources.filter((s) => s.unreadable).map((s) => s.path)
      out.push({ scope, registry: reg.value, token: token?.value, tokenSource: token?.source?.name, tokenPath: token?.source?.path, unreadable, secrets: token ? secretsIn(token.value) : [] })
    }
    return out
  }

  tsBuild(env) {
    const nm = this.file(`${this.cwd}/node_modules`)
    const pkg = this.packageJson()
    if (!pkg) return this.fail(`the TypeScript build runs in ${this.cwd}, which has no package.json`)
    if (!nm) return this.fail(`the TypeScript build runs in ${this.cwd} before any npm install there, so tsc is not available`)
    if (!nm.dev) return this.fail(`the TypeScript build runs after an install without devDependencies, so tsc (a devDependency) is missing`)
    if (!this.exists(`${this.cwd}/tsconfig.json`)) return this.fail(`the TypeScript build runs in ${this.cwd} without tsconfig.json`)
    if (!this.exists(`${this.cwd}/src`)) return this.fail(`the TypeScript build runs in ${this.cwd} without the src/ directory`)
    const out = cleanPath(`${this.cwd}/${this.tsOutDir}`)
    this.created.set(out, { type: 'dir', generated: true, origin: { kind: 'build', projectDir: this.cwd, outRel: this.tsOutDir }, deps: this.record.deps, line: this.record.line })
    this.stage.builds.push({ line: this.record.line, out, deps: this.record.deps })
  }

  finish() {
    // Everything written outside cache/tmpfs/secret mounts becomes part of the layer.
    for (const [p, e] of this.created) {
      const mount = [...this.overlay.keys()].find((m) => under(p, m) && this.overlay.get(m).volatile)
      if (mount) continue
      if (this.overlay.has(p) && this.overlay.get(p).origin?.kind === 'secret') continue
      this.stage.fs.set(p, e)
      if (hasSecret(e.content)) this.stage.leaks.push({ line: this.record.line, path: p, how: e.origin?.how, secrets: secretsIn(e.content) })
    }
  }
}

export function parseIni(text) {
  const kv = {}
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || line.startsWith(';')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    kv[line.slice(0, eq).trim()] = line.slice(eq + 1).trim().replace(/^"(.*)"$/, '$1')
  }
  return kv
}

/** npm replaces ${VAR} in .npmrc values from its environment and leaves unknown ones as written. */
export function expandNpmEnv(value, env) {
  return String(value).replace(/(\\*)\$\{([^}?]+)(\?)?\}/g, (orig, escs, name, opt) => {
    if (escs.length % 2) return orig.slice((escs.length + 1) / 2)
    if (env[name] !== undefined) return escs.slice(escs.length / 2) + env[name]
    return opt ? '' : orig
  })
}

/* ---------------------------------------------------------------------------------------------- */
/* Final image helpers                                                                             */
/* ---------------------------------------------------------------------------------------------- */

/** The process Docker starts: ENTRYPOINT + CMD. */
export function containerArgv(stage) {
  const ep = stage.config.entrypoint ?? []
  const cmd = stage.config.cmd ?? []
  return [...ep, ...cmd]
}

/** Resolves a command name the way the container runtime does (PATH lookup in the image). */
export function resolveExecutable(stage, name, workdir = stage.config.workdir || '/') {
  if (!name) return undefined
  if (name.includes('/')) {
    const p = absPath(name, workdir)
    return stage.fs.exists(p) ? p : undefined
  }
  for (const dir of (stage.config.env.PATH ?? DEFAULT_PATH).split(':')) {
    const p = cleanPath(`${dir}/${name}`)
    if (stage.fs.exists(p)) return p
    // /bin and /usr/bin are the same directory in merged-/usr images.
    const alt = p.startsWith('/usr/bin/') ? p.replace('/usr/bin/', '/bin/') : p.startsWith('/bin/') ? p.replace('/bin/', '/usr/bin/') : undefined
    if (alt && stage.fs.exists(alt)) return alt
  }
  return undefined
}

/** User as Kubernetes sees it (containerd getUserFromImage + kubelet verifyRunAsNonRoot). */
export function kubernetesNonRoot(user) {
  const u = String(user ?? '').split(':')[0]
  if (u === '') return { ok: false, why: 'the image has no USER, so it runs as root (uid 0)' }
  if (!/^\d+$/.test(u)) return { ok: false, why: `USER is "${user}", a name; with runAsNonRoot the kubelet refuses it: "image has non-numeric user (${u}), cannot verify user is non-root"` }
  if (Number(u) === 0) return { ok: false, why: 'USER resolves to uid 0 (root)' }
  return { ok: true, uid: Number(u) }
}

/** Splits a simple shell command line (no operators) into evaluated words, for argv analysis. */
export function shellWords(src, env = {}) {
  const cmds = splitShell(src)
  return cmds.map((c) => ({ assigns: c.assigns, words: c.words.map((w) => evalShellWord(w, env)), op: c.op, redirs: c.redirs }))
}

/* ---------------------------------------------------------------------------------------------- */
/* Build scripts: what `docker build` / `docker buildx build` receive                             */
/* ---------------------------------------------------------------------------------------------- */

const BUILD_VALUE_FLAGS = new Set(['--secret', '--build-arg', '-f', '--file', '--target', '--label', '--annotation', '--build-context', '-t', '--tag', '--platform', '--provenance', '--sbom', '--attest', '--cache-to', '--cache-from', '--output', '-o', '--progress', '--network', '--ssh', '--iidfile', '--metadata-file', '--builder', '--shm-size', '--ulimit', '--add-host', '--allow', '--call', '--check', '--cgroup-parent', '--policy', '--load-file', '--memory', '-m', '--cpu-shares', '--cpuset-cpus', '--isolation', '--no-cache-filter', '--quiet-file'])

/** Parses `--secret` the way buildx does (type/id/src|source/env), resolving the value. */
export function resolveSecretSpec(spec, env, readFile) {
  const s = {}
  for (const field of spec.split(',')) {
    const eq = field.indexOf('=')
    const k = (eq === -1 ? field : field.slice(0, eq)).trim().toLowerCase()
    const v = eq === -1 ? '' : field.slice(eq + 1).trim()
    if (k === 'type') s.type = v
    else if (k === 'id') s.id = v
    else if (k === 'src' || k === 'source') s.src = v
    else if (k === 'env') s.env = v
  }
  if (s.type === 'env' && !s.env) {
    s.env = s.src ?? s.id
    s.src = undefined
  }
  let value
  let how
  if (s.env) {
    value = env[s.env]
    how = `environment variable ${s.env}`
  } else if (s.src) {
    value = readFile(s.src)
    how = `file ${s.src}`
  } else if (s.id && env[s.id] !== undefined) {
    value = env[s.id]
    how = `environment variable ${s.id} (no src or env given)`
  } else if (s.id) {
    value = readFile(s.id)
    how = `file ${s.id} (no src or env given)`
  }
  return { ...s, value, how }
}

function expandArrayWords(raw, arrays, ev) {
  const m = /^"?\$\{([A-Za-z_][A-Za-z0-9_]*)\[[@*]\]\}"?$/.exec(raw)
  if (m) return arrays[m[1]] ?? []
  return [ev(raw)]
}

/**
 * Runs a build script symbolically. `env` is the starting environment (values may carry
 * secretValue() marks). Returns every docker build invocation with its flags, plus the files the
 * script writes before building.
 */
export function analyzeBuildScript(text, { env = {}, root, cwd = '.' } = {}) {
  const vars = { ...env }
  const arrays = {}
  const files = new Map()
  const builds = []
  let dir = cwd
  const subst = (inner) => {
    const c = splitShell(inner)[0]
    if (!c) return ''
    const w = c.words.map((x) => evalShellWord(x, vars, subst))
    if (w[0] === 'mktemp') return `/tmp/tmp.script${files.size}`
    if (w[0] === 'git' && w.includes('rev-parse')) return '0a1b2c3'
    if (w[0] === 'cat' && w[1]) return readFile(w[1])?.replace(/\n+$/, '') ?? ''
    if (w[0] === 'pwd') return dir
    if (w[0] === 'dirname') return posix.dirname(w[1] ?? '.')
    if (w[0] === 'date') return '20261101'
    return ''
  }
  const ev = (raw) => evalShellWord(raw, vars, subst)
  const scriptPath = (p) => (p.startsWith('/') ? p : cleanPath(`${dir}/${p}`))
  function readFile(p) {
    const abs = scriptPath(p)
    if (files.has(abs)) return files.get(abs)
    if (root && !abs.startsWith('/')) {
      const full = join(root, abs)
      if (existsSync(full) && statSync(full).isFile()) return readFileSync(full, 'utf8')
    }
    return undefined
  }
  for (const c of splitShell(text)) {
    for (const a of c.assigns) {
      if (a.raw.startsWith('(')) {
        const inner = a.raw.slice(1, -1)
        const words = splitShell(inner).flatMap((x) => x.words.flatMap((w) => expandArrayWords(w, arrays, ev)))
        arrays[a.name] = a.append ? [...(arrays[a.name] ?? []), ...words] : words
      } else if (!c.words.length) vars[a.name] = a.append ? (vars[a.name] ?? '') + ev(a.raw) : ev(a.raw)
    }
    if (!c.words.length) continue
    let words = c.words.flatMap((w) => expandArrayWords(w, arrays, ev))
    while (['if', 'then', 'else', 'elif', 'do', '!', '{', 'time', 'exec', 'command', 'sudo'].includes(words[0])) words = words.slice(1)
    if (!words.length) continue
    const [cmd, ...args] = words
    if (cmd === ':' || cmd === 'true' || cmd === '[' || cmd === 'test') {
      // `: "${VAR:=default}"` assigns; evaluate for side effects.
      for (const w of c.words.slice(1)) {
        const m = /\$\{([A-Za-z_][A-Za-z0-9_]*):?=([^}]*)\}/.exec(w)
        if (m && !vars[m[1]]) vars[m[1]] = ev(m[2])
      }
      continue
    }
    if (cmd === 'export' || cmd === 'local' || cmd === 'readonly' || cmd === 'declare' || cmd === 'typeset') {
      for (const raw of c.words.slice(1)) {
        const m = /^([A-Za-z_][A-Za-z0-9_]*)=([\s\S]*)$/.exec(raw)
        if (m) vars[m[1]] = ev(m[2])
      }
      continue
    }
    if (cmd === 'cd') {
      dir = scriptPath(args[0] ?? '.')
      continue
    }
    if (cmd === 'echo' || cmd === 'printf' || cmd === 'cat' || cmd === 'tee') {
      let content
      if (cmd === 'echo') content = `${args.filter((a) => !/^-[neE]+$/.test(a)).join(' ')}\n`
      else if (cmd === 'printf') {
        const [fmt = '', ...rest] = args
        let k = 0
        content = fmt.replace(/%[sdb%]/g, (m) => (m === '%%' ? '%' : (rest[k++] ?? ''))).replace(/\\n/g, '\n')
      } else {
        const body = c.redirs.find((r) => r.heredoc)?.heredoc
        content = body ? (body.expand ? ev(`"${body.body.replace(/"/g, '\\"')}"`) : body.body) : args.filter((a) => !a.startsWith('-')).map((f) => (cmd === 'cat' ? (readFile(f) ?? '') : '')).join('')
        if (cmd === 'tee') for (const f of args.filter((a) => !a.startsWith('-'))) files.set(scriptPath(f), content)
      }
      for (const r of c.redirs) {
        if (!['>', '>>', '>|'].includes(r.op) || r.fd === '2') continue
        const target = ev(r.target)
        if (target === '/dev/null' || target.startsWith('&')) continue
        const p = scriptPath(target)
        files.set(p, (r.op === '>>' ? (files.get(p) ?? '') : '') + content)
      }
      continue
    }
    if (cmd === 'rm') {
      for (const a of args.filter((x) => !x.startsWith('-'))) files.delete(scriptPath(a))
      continue
    }
    if (posix.basename(cmd) !== 'docker') continue
    let k = 0
    const rest = [...args]
    if (rest[0] === 'buildx' || rest[0] === 'image') rest.shift()
    if (!['build', 'b'].includes(rest[0])) continue
    rest.shift()
    const inv = { secrets: [], buildArgs: {}, buildArgList: [], labels: [], annotations: [], flags: {}, positional: [], dir, raw: words.join(' ') }
    for (k = 0; k < rest.length; k++) {
      let a = rest[k]
      let v
      if (a.startsWith('--') && a.includes('=')) {
        v = a.slice(a.indexOf('=') + 1)
        a = a.slice(0, a.indexOf('='))
      } else if (BUILD_VALUE_FLAGS.has(a)) v = rest[++k]
      else if (/^-[ft]./.test(a)) {
        v = a.slice(2)
        a = a.slice(0, 2)
      }
      if (!a.startsWith('-')) {
        inv.positional.push(a)
        continue
      }
      ;(inv.flags[a] ??= []).push(v ?? true)
      if (a === '--secret') inv.secrets.push(resolveSecretSpec(v, vars, readFile))
      if (a === '--build-arg') {
        const eq = v.indexOf('=')
        const name = eq === -1 ? v : v.slice(0, eq)
        const value = eq === -1 ? vars[name] : v.slice(eq + 1)
        inv.buildArgList.push({ name, value, spec: v })
        if (value !== undefined) inv.buildArgs[name] = value
      }
      if (a === '--label') inv.labels.push(v)
      if (a === '--annotation') inv.annotations.push(v)
    }
    inv.context = inv.positional.at(-1) ?? '.'
    inv.dockerfile = inv.flags['-f']?.at(-1) ?? inv.flags['--file']?.at(-1)
    inv.target = inv.flags['--target']?.at(-1)
    builds.push(inv)
  }
  return { builds, files, vars }
}

/** Stages BuildKit actually builds for the target: its parents and every stage it copies or mounts from. */
export function reachableStages(sim) {
  const out = new Set()
  const visit = (s) => {
    if (!s || out.has(s)) return
    out.add(s)
    visit(s.parent)
    for (const r of s.refs) visit(r)
  }
  visit(sim.final)
  return [...out].sort((a, b) => a.index - b.index)
}

const INITS = new Set(['tini', 'tini-static', 'dumb-init', 'docker-init', 'catatonit'])
const SHELLS = /^(sh|bash|ash|dash|busybox)$/

/**
 * What PID 1 ends up being once known wrappers have exec'd: the node image's docker-entrypoint.sh
 * (execs its arguments, prefixing `node` when the first one is not a command), init shims, and
 * `sh -c` scripts. Debian's dash keeps itself as PID 1 for `sh -c "cmd"`; BusyBox ash execs a lone
 * simple command (both measured with docker stop on node:24-slim and node:24-alpine).
 */
export function effectiveCommand(stage) {
  let argv = containerArgv(stage)
  const chain = []
  const wd = stage.config.workdir || '/'
  for (let guard = 0; guard < 8 && argv.length; guard++) {
    const exe = argv[0]
    const base = posix.basename(exe)
    if (base === 'docker-entrypoint.sh') {
      chain.push('docker-entrypoint.sh')
      argv = argv.slice(1)
      if (!argv.length || argv[0].startsWith('-') || !resolveExecutable(stage, argv[0], wd) || /\.(c|m)?js$/.test(argv[0])) argv = ['node', ...argv]
      continue
    }
    if (INITS.has(base)) {
      chain.push(base)
      const resolved = resolveExecutable(stage, exe, wd)
      if (!resolved) return { argv, pid1: exe, chain, missing: exe }
      argv = argv.slice(1)
      while (argv.length && argv[0].startsWith('-')) {
        const f = argv.shift()
        if (f === '--') break
        if (/^-(e|p|c)$/.test(f) && base !== 'dumb-init') argv.shift()
        if (f === '--rewrite' || f === '-r') argv.shift()
      }
      return { argv, pid1: base, init: true, chain }
    }
    if (SHELLS.test(base) && argv.includes('-c')) {
      const script = argv[argv.indexOf('-c') + 1] ?? ''
      const shellKind = base === 'bash' ? 'bash' : (stage.base?.shell ?? 'dash')
      if (!resolveExecutable(stage, exe, wd)) return { argv, pid1: exe, chain, missing: exe, shellForm: true }
      const cmds = splitShell(script)
      const first = cmds[0]
      if (first && evalShellWord(first.words[0] ?? '', stage.config.env) === 'exec') {
        chain.push(`${base} -c exec`)
        argv = first.words.slice(1).map((w) => evalShellWord(w, stage.config.env))
        continue
      }
      const simple = cmds.length === 1 && !first.redirs.length && first.assigns.length === 0
      if (simple && (shellKind === 'busybox' || shellKind === 'bash')) {
        chain.push(`${base} -c (${shellKind} execs a single command)`)
        argv = first.words.map((w) => evalShellWord(w, stage.config.env))
        continue
      }
      return { argv, pid1: exe, chain, shellForm: true, script, shellKind }
    }
    break
  }
  return { argv, pid1: argv[0], chain }
}
