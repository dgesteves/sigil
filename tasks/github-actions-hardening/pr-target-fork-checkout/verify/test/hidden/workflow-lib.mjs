// Hidden verifier support: reads GitHub Actions workflows statically and simulates the parts of a
// run that matter for these tasks (expression interpolation, bash `run` steps, actions/checkout and
// actions/github-script) with a recording fake `gh` CLI and Octokit client. No network is used.
import { spawnSync } from 'node:child_process'
import {
  appendFileSync,
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { parse } from 'yaml'

/* ---------------------------------------------------------------------------------------------- */
/* Loading                                                                                         */
/* ---------------------------------------------------------------------------------------------- */

export function loadWorkflows(root) {
  const dir = join(root, '.github', 'workflows')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => /\.ya?ml$/.test(f))
    .sort()
    .map((file) => {
      const text = readFileSync(join(dir, file), 'utf8')
      let doc
      let error
      try {
        doc = parse(text)
      } catch (e) {
        error = e.message
      }
      return { file, text, doc, error }
    })
}

/** Normalises `on:` into { eventName: config }. */
export function triggers(doc) {
  const on = doc?.on ?? doc?.true
  if (typeof on === 'string') return { [on]: {} }
  if (Array.isArray(on)) return Object.fromEntries(on.map((e) => [e, {}]))
  if (on && typeof on === 'object')
    return Object.fromEntries(Object.entries(on).map(([k, v]) => [k, v ?? {}]))
  return {}
}

export function jobsOf(doc) {
  return Object.entries(doc?.jobs ?? {})
}

/** Effective GITHUB_TOKEN permissions for a job: job level wins over workflow level. */
export function effectivePermissions(doc, job) {
  const raw = job?.permissions !== undefined ? job.permissions : doc?.permissions
  if (raw === undefined || raw === null) return { declared: false, scopes: {} }
  if (raw === 'read-all') return { declared: true, all: 'read', scopes: {} }
  if (raw === 'write-all') return { declared: true, all: 'write', scopes: {} }
  if (typeof raw === 'object') return { declared: true, scopes: { ...raw } }
  return { declared: true, scopes: {}, invalid: raw }
}

export function writeScopes(perms) {
  if (perms.all === 'write') return ['*']
  return Object.entries(perms.scopes)
    .filter(([, v]) => v === 'write')
    .map(([k]) => k)
}

export function stepsOf(job) {
  return Array.isArray(job?.steps) ? job.steps : []
}

export function actionName(uses) {
  if (typeof uses !== 'string') return undefined
  return uses.split('@')[0].toLowerCase()
}

export function actionRef(uses) {
  if (typeof uses !== 'string' || !uses.includes('@')) return undefined
  return uses.slice(uses.lastIndexOf('@') + 1)
}

/* ---------------------------------------------------------------------------------------------- */
/* Static safety checks                                                                            */
/* ---------------------------------------------------------------------------------------------- */

/** `${{ ... }}` bodies inside a string. Ends at the first `}}` outside a string literal. */
export function expressions(text) {
  const out = []
  if (typeof text !== 'string') return out
  let i = 0
  for (;;) {
    const start = text.indexOf('${{', i)
    if (start < 0) return out
    let j = start + 3
    let inString = false
    while (j < text.length) {
      const c = text[j]
      if (inString) {
        if (c === "'" && text[j + 1] === "'") j++
        else if (c === "'") inString = false
      } else if (c === "'") inString = true
      else if (c === '}' && text[j + 1] === '}') break
      j++
    }
    out.push({ expr: text.slice(start + 3, j).trim(), start, end: j + 2 })
    i = j + 2
  }
}

// GitHub's docs list context fields ending in these names as attacker-controllable.
const UNTRUSTED_LEAVES = new Set([
  'body',
  'default_branch',
  'email',
  'head_ref',
  'label',
  'message',
  'name',
  'page_name',
  'ref',
  'title',
])

/** True when an expression can expand to text an outside contributor controls. */
export function isUntrustedExpression(expr) {
  if (/\bgithub\s*\.\s*head_ref\b/.test(expr)) return true
  if (/toJSON\s*\(\s*github\s*\.\s*event\b/i.test(expr)) return true
  for (const m of expr.matchAll(/\bgithub\s*\.\s*event((?:\s*\.\s*[\w-]+|\s*\.\s*\*|\s*\[[^\]]*\])*)/g)) {
    const path = m[1]
      .replace(/\s+/g, '')
      .split(/\.|\[|\]/)
      .filter(Boolean)
      .map((s) => s.replace(/^['"]|['"]$/g, ''))
    if (path.length === 0) return true // the whole event object
    const leaf = path[path.length - 1]
    if (UNTRUSTED_LEAVES.has(leaf)) return true
    if (['issue', 'pull_request', 'comment', 'review', 'head_commit', 'commits', 'discussion'].includes(leaf))
      return true // whole objects stringify their untrusted fields too
  }
  return false
}

/** Places where untrusted expressions are expanded into code: `run:` scripts and github-script. */
export function injectionSinks(doc) {
  const found = []
  for (const [jobId, job] of jobsOf(doc)) {
    stepsOf(job).forEach((step, index) => {
      const where = `${jobId} step ${index + 1}${step.name ? ` (${step.name})` : ''}`
      const sinks = []
      if (typeof step.run === 'string') sinks.push(['run', step.run])
      if (actionName(step.uses) === 'actions/github-script' && step.with?.script)
        sinks.push(['script', String(step.with.script)])
      for (const [kind, text] of sinks) {
        for (const { expr } of expressions(text)) {
          if (isUntrustedExpression(expr)) found.push(`${where}: \${{ ${expr} }} expanded inside ${kind}`)
        }
      }
    })
  }
  return found
}

const PR_CODE = [
  /github\s*\.\s*event\s*\.\s*pull_request\s*\.\s*head\b/,
  /github\s*\.\s*event\s*\.\s*pull_request\s*\.\s*merge_commit_sha\b/,
  /github\s*\.\s*event\s*\.\s*workflow_run\s*\.\s*head_(sha|branch|repository)\b/,
  /github\s*\.\s*event\s*\.\s*workflow_run\s*\.\s*pull_requests\b/,
  /github\s*\.\s*head_ref\b/,
  /refs\/pull\//,
]

/** Ways a privileged workflow (pull_request_target / workflow_run) fetches pull request code. */
export function untrustedCheckouts(doc) {
  const on = triggers(doc)
  if (!('pull_request_target' in on) && !('workflow_run' in on)) return []
  const found = []
  for (const [jobId, job] of jobsOf(doc)) {
    stepsOf(job).forEach((step, index) => {
      const where = `${jobId} step ${index + 1}${step.name ? ` (${step.name})` : ''}`
      if (actionName(step.uses) === 'actions/checkout') {
        const w = step.with ?? {}
        const unsafe = w['allow-unsafe-pr-checkout']
        if (unsafe === true || String(unsafe).trim().toLowerCase() === 'true' || /\$\{\{/.test(String(unsafe ?? '')))
          found.push(`${where}: actions/checkout with allow-unsafe-pr-checkout`)
        for (const key of ['ref', 'repository']) {
          const value = String(w[key] ?? '')
          if (PR_CODE.some((re) => re.test(value)))
            found.push(`${where}: actions/checkout ${key}: ${value} checks out pull request code`)
        }
      }
      if (typeof step.run === 'string') {
        const run = step.run
        if (/\bgh\s+pr\s+checkout\b/.test(run)) found.push(`${where}: gh pr checkout in a privileged workflow`)
        if (/\bgit\s+(fetch|pull)\b[^\n]*(pull\/|refs\/pull|head\.repo|clone_url|\$\{\{)/.test(run))
          found.push(`${where}: git fetch of pull request code in a privileged workflow`)
        if (/\bgit\s+(checkout|switch|reset|worktree)\b[^\n]*(FETCH_HEAD|pull\/|\$\{\{\s*github\.(event\.pull_request\.head|head_ref))/.test(run))
          found.push(`${where}: git checkout of pull request code in a privileged workflow`)
        if (/\bgit\s+clone\b[^\n]*\$\{\{\s*github\.event\.pull_request\.head/.test(run))
          found.push(`${where}: git clone of the fork in a privileged workflow`)
      }
    })
  }
  return found
}

/* ---------------------------------------------------------------------------------------------- */
/* SHA pinning                                                                                     */
/* ---------------------------------------------------------------------------------------------- */

export function isFullSha(ref) {
  return typeof ref === 'string' && /^[0-9a-f]{40}$/.test(ref)
}

/** Every remote `uses:` in a workflow (steps and reusable-workflow jobs). */
export function remoteUses(doc) {
  const out = []
  for (const [jobId, job] of jobsOf(doc)) {
    if (typeof job?.uses === 'string' && !job.uses.startsWith('./')) out.push({ where: jobId, uses: job.uses })
    stepsOf(job).forEach((step, i) => {
      if (typeof step.uses === 'string' && !step.uses.startsWith('./') && !step.uses.startsWith('docker://'))
        out.push({ where: `${jobId} step ${i + 1}`, uses: step.uses })
    })
  }
  return out
}

/* ---------------------------------------------------------------------------------------------- */
/* Expressions                                                                                     */
/* ---------------------------------------------------------------------------------------------- */

function tokenize(src) {
  const tokens = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (/\s/.test(c)) {
      i++
      continue
    }
    if (c === "'") {
      let j = i + 1
      let s = ''
      for (;;) {
        if (j >= src.length) throw new Error(`unterminated string in ${src}`)
        if (src[j] === "'" && src[j + 1] === "'") {
          s += "'"
          j += 2
        } else if (src[j] === "'") break
        else s += src[j++]
      }
      tokens.push({ t: 'str', v: s })
      i = j + 1
      continue
    }
    const two = src.slice(i, i + 2)
    if (['==', '!=', '<=', '>=', '&&', '||'].includes(two)) {
      tokens.push({ t: 'op', v: two })
      i += 2
      continue
    }
    if ('!<>()[].,*'.includes(c)) {
      tokens.push({ t: 'op', v: c })
      i++
      continue
    }
    const num = /^(0x[0-9a-fA-F]+|-?\d+(\.\d+)?(e[+-]?\d+)?)/.exec(src.slice(i))
    if (num && !/[A-Za-z_]/.test(src[i - 1] ?? '')) {
      tokens.push({ t: 'num', v: Number(num[0]) })
      i += num[0].length
      continue
    }
    const id = /^[A-Za-z_][\w-]*/.exec(src.slice(i))
    if (id) {
      tokens.push({ t: 'id', v: id[0] })
      i += id[0].length
      continue
    }
    throw new Error(`unexpected "${c}" in expression ${src}`)
  }
  return tokens
}

const lower = (v) => (typeof v === 'string' ? v.toLowerCase() : v)
function toNum(v) {
  if (v === null || v === undefined) return 0
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v === 'number') return v
  if (typeof v === 'string') return v.trim() === '' ? 0 : Number(v)
  return Number.NaN
}
function looseEq(a, b) {
  if (typeof a === 'string' && typeof b === 'string') return a.toLowerCase() === b.toLowerCase()
  if ((a === null || a === undefined) && (b === null || b === undefined)) return true
  if (typeof a === 'object' || typeof b === 'object') return a === b
  return toNum(a) === toNum(b)
}
export function truthy(v) {
  return !(v === false || v === null || v === undefined || v === 0 || v === '' || Number.isNaN(v))
}
export function stringify(v) {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return Array.isArray(v) ? 'Array' : 'Object'
}

export function evaluate(src, ctx) {
  const tokens = tokenize(src)
  let p = 0
  const peek = () => tokens[p]
  const eat = (v) => {
    const t = tokens[p]
    if (!t || (v !== undefined && t.v !== v)) throw new Error(`expected ${v} in ${src}`)
    p++
    return t
  }
  const parseOr = () => {
    let left = parseAnd()
    while (peek()?.v === '||') {
      eat()
      const right = parseAnd()
      left = truthy(left) ? left : right
    }
    return left
  }
  const parseAnd = () => {
    let left = parseEq()
    while (peek()?.v === '&&') {
      eat()
      const right = parseEq()
      left = truthy(left) ? right : left
    }
    return left
  }
  const parseEq = () => {
    let left = parseCmp()
    while (peek()?.v === '==' || peek()?.v === '!=') {
      const op = eat().v
      const right = parseCmp()
      left = op === '==' ? looseEq(left, right) : !looseEq(left, right)
    }
    return left
  }
  const parseCmp = () => {
    let left = parseUnary()
    while (['<', '>', '<=', '>='].includes(peek()?.v)) {
      const op = eat().v
      const right = parseUnary()
      const [a, b] =
        typeof left === 'string' && typeof right === 'string'
          ? [left.toLowerCase(), right.toLowerCase()]
          : [toNum(left), toNum(right)]
      left = op === '<' ? a < b : op === '>' ? a > b : op === '<=' ? a <= b : a >= b
    }
    return left
  }
  const parseUnary = () => {
    if (peek()?.v === '!') {
      eat()
      return !truthy(parseUnary())
    }
    return parsePostfix()
  }
  const access = (base, key) => {
    if (Array.isArray(base) && base.__filter) {
      const mapped = base.map((x) => (x && typeof x === 'object' ? x[key] : undefined))
      mapped.__filter = true
      return mapped
    }
    if (base === null || base === undefined || typeof base !== 'object') return null
    const k = Object.keys(base).find((x) => x.toLowerCase() === String(key).toLowerCase())
    return k === undefined ? null : base[k]
  }
  const parsePostfix = () => {
    let value = parsePrimary()
    for (;;) {
      if (peek()?.v === '.') {
        eat()
        const t = eat()
        if (t.v === '*') {
          const arr = value && typeof value === 'object' ? Object.values(value) : []
          arr.__filter = true
          value = arr
        } else value = access(value, t.v)
      } else if (peek()?.v === '[') {
        eat()
        const key = parseOr()
        eat(']')
        value = access(value, key)
      } else return value
    }
  }
  const call = (name, args) => {
    const n = name.toLowerCase()
    const status = ctx.__status ?? 'success'
    switch (n) {
      case 'success':
        return status === 'success'
      case 'failure':
        return status === 'failure'
      case 'always':
        return true
      case 'cancelled':
        return false
      case 'contains': {
        const [hay, needle] = args
        if (Array.isArray(hay)) return hay.some((x) => looseEq(x, needle))
        return stringify(hay).toLowerCase().includes(stringify(needle).toLowerCase())
      }
      case 'startswith':
        return stringify(args[0]).toLowerCase().startsWith(stringify(args[1]).toLowerCase())
      case 'endswith':
        return stringify(args[0]).toLowerCase().endsWith(stringify(args[1]).toLowerCase())
      case 'format':
        return stringify(args[0])
          .replace(/\{(\d+)\}/g, (_, i) => stringify(args[Number(i) + 1]))
          .replace(/\{\{/g, '{')
          .replace(/\}\}/g, '}')
      case 'join':
        return Array.isArray(args[0]) ? args[0].map(stringify).join(args[1] ?? ',') : stringify(args[0])
      case 'tojson':
        return JSON.stringify(args[0] ?? null, null, 2)
      case 'fromjson':
        return JSON.parse(stringify(args[0]))
      case 'hashfiles':
        return ''
      default:
        throw new Error(`unsupported function ${name}()`)
    }
  }
  const parsePrimary = () => {
    const t = eat()
    if (t.t === 'str' || t.t === 'num') return t.v
    if (t.v === '(') {
      const v = parseOr()
      eat(')')
      return v
    }
    if (t.t === 'id') {
      if (peek()?.v === '(') {
        eat('(')
        const args = []
        if (peek()?.v !== ')') {
          args.push(parseOr())
          while (peek()?.v === ',') {
            eat()
            args.push(parseOr())
          }
        }
        eat(')')
        return call(t.v, args)
      }
      const id = t.v.toLowerCase()
      if (id === 'true') return true
      if (id === 'false') return false
      if (id === 'null') return null
      return access(ctx, t.v)
    }
    throw new Error(`unexpected token ${t.v} in ${src}`)
  }
  const value = parseOr()
  if (p !== tokens.length) throw new Error(`trailing tokens in ${src}`)
  return value
}

export function interpolate(text, ctx) {
  if (typeof text !== 'string') return text
  let out = ''
  let last = 0
  for (const { expr, start, end } of expressions(text)) {
    out += text.slice(last, start) + stringify(evaluate(expr, ctx))
    last = end
  }
  return out + text.slice(last)
}

function evalIf(cond, ctx) {
  if (cond === undefined || cond === null) return ctx.__status === 'success'
  if (typeof cond === 'boolean') return cond && ctx.__status === 'success'
  let src = String(cond).trim()
  const only = expressions(src)
  if (only.length === 1 && only[0].start === 0 && only[0].end === src.length) src = only[0].expr
  const usesStatus = /\b(success|failure|always|cancelled)\s*\(/i.test(src)
  const v = truthy(evaluate(src, ctx))
  return usesStatus ? v : v && ctx.__status === 'success'
}

/* ---------------------------------------------------------------------------------------------- */
/* Simulation                                                                                      */
/* ---------------------------------------------------------------------------------------------- */

const FAKE_GH = `#!/usr/bin/env node
const fs = require('node:fs')
const argv = process.argv.slice(2)
const files = {}
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  const next = argv[i + 1]
  if ((a === '--body-file' || a === '-F' || a === '--input') && next && next !== '-' && fs.existsSync(next)) files[next] = fs.readFileSync(next, 'utf8')
  const m = /^(?:-F|--field)$/.test(a) && next && /^[^=]+=@(.+)$/.exec(next)
  if (m && fs.existsSync(m[1])) files[m[1]] = fs.readFileSync(m[1], 'utf8')
}
const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || ''
fs.appendFileSync(process.env.SIM_LOG, JSON.stringify({ via: 'gh', argv, files, token: Boolean(token) }) + '\\n')
if (!token) {
  console.error('gh: To use GitHub CLI in a GitHub Actions workflow, set the GH_TOKEN environment variable.')
  process.exit(4)
}
if (process.env.SIM_READONLY === '1' && !['view', 'list', 'diff', 'status'].includes(argv[1]) && argv[0] !== 'auth') {
  console.error('HTTP 403: Resource not accessible by integration')
  process.exit(1)
}
`

function writeFakeBin(dir) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'gh'), FAKE_GH)
  chmodSync(join(dir, 'gh'), 0o755)
}

function parseKeyValueFile(file) {
  const out = {}
  if (!existsSync(file)) return out
  const lines = readFileSync(file, 'utf8').split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const heredoc = /^([^=<]+)<<(.+)$/.exec(line)
    if (heredoc) {
      const [, name, delim] = heredoc
      const value = []
      i++
      while (i < lines.length && lines[i] !== delim) value.push(lines[i++])
      out[name] = value.join('\n')
      continue
    }
    const eq = line.indexOf('=')
    if (eq > 0) out[line.slice(0, eq)] = line.slice(eq + 1)
  }
  return out
}

function fakeOctokit(record, readOnly) {
  const make = (path) =>
    new Proxy(() => {}, {
      get(_t, prop) {
        if (prop === 'then') return undefined
        return make([...path, String(prop)])
      },
      async apply(_t, _this, args) {
        const api = path.join('.')
        if (api === 'paginate') {
          return []
        }
        if (api === 'request' || api === 'graphql') {
          record({ via: 'octokit', api, route: args[0], params: args[1] ?? {} })
          if (readOnly && api === 'request' && !/^GET\s/i.test(String(args[0]))) throw forbidden()
          return api === 'graphql' ? {} : { data: {} }
        }
        const method = path[path.length - 1] ?? ''
        record({ via: 'octokit', api: path.filter((p) => p !== 'rest').join('.'), params: args[0] ?? {} })
        if (readOnly && !/^(get|list|check)/.test(method)) throw forbidden()
        return { data: /^list/.test(method) ? [] : {}, status: 200 }
      },
    })
  return make([])
}
function forbidden() {
  const e = new Error('Resource not accessible by integration')
  e.status = 403
  return e
}

function fakeCore(stepState) {
  const summaryParts = []
  const summary = {
    addRaw(text, eol = false) {
      summaryParts.push(String(text) + (eol ? '\n' : ''))
      return summary
    },
    addEOL() {
      summaryParts.push('\n')
      return summary
    },
    addHeading(text, level = 1) {
      summaryParts.push(`<h${level}>${text}</h${level}>\n`)
      return summary
    },
    addCodeBlock(code) {
      summaryParts.push(`<pre><code>${code}</code></pre>\n`)
      return summary
    },
    addList(items) {
      summaryParts.push(`<ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>\n`)
      return summary
    },
    addQuote(text) {
      summaryParts.push(`<blockquote>${text}</blockquote>\n`)
      return summary
    },
    addLink(text, href) {
      summaryParts.push(`<a href="${href}">${text}</a>`)
      return summary
    },
    addSeparator() {
      summaryParts.push('<hr>\n')
      return summary
    },
    addBreak() {
      summaryParts.push('<br>\n')
      return summary
    },
    addDetails(label, content) {
      summaryParts.push(`<details><summary>${label}</summary>${content}</details>\n`)
      return summary
    },
    addTable(rows) {
      summaryParts.push(`<table>${JSON.stringify(rows)}</table>\n`)
      return summary
    },
    addImage(src, alt) {
      summaryParts.push(`<img src="${src}" alt="${alt}">`)
      return summary
    },
    stringify() {
      return summaryParts.join('')
    },
    isEmptyBuffer() {
      return summaryParts.length === 0
    },
    emptyBuffer() {
      summaryParts.length = 0
      return summary
    },
    async write() {
      appendFileSync(stepState.summaryFile, summaryParts.join(''))
      summaryParts.length = 0
      return summary
    },
    async clear() {
      return summary
    },
  }
  const log = (...a) => stepState.output.push(a.join(' '))
  return {
    getInput: (name) => stringify(stepState.inputs[name] ?? stepState.inputs[name.toLowerCase()] ?? ''),
    getBooleanInput: (name) => String(stepState.inputs[name] ?? '').toLowerCase() === 'true',
    getMultilineInput: (name) => stringify(stepState.inputs[name] ?? '').split('\n').filter(Boolean),
    setOutput: (name, value) => {
      stepState.outputs[name] = typeof value === 'string' ? value : JSON.stringify(value)
    },
    exportVariable: (name, value) => {
      stepState.exported[name] = String(value)
    },
    setSecret: () => {},
    addPath: () => {},
    setFailed: (msg) => {
      stepState.failed = String(msg?.message ?? msg)
    },
    info: log,
    debug: () => {},
    notice: log,
    warning: log,
    error: log,
    startGroup: log,
    endGroup: () => {},
    group: async (_name, fn) => fn(),
    isDebug: () => false,
    summary,
  }
}

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor

// The workspace gets the repository as committed: no installed modules, no git dir, no verifier.
function copyRepo(from, to) {
  mkdirSync(to, { recursive: true })
  cpSync(from, to, {
    recursive: true,
    filter: (src) => {
      const rel = relative(from, src).split(/[\\/]/).join('/')
      if (rel === 'test/hidden' || rel.startsWith('test/hidden/')) return false
      return !rel.split('/').some((part) => part === 'node_modules' || part === '.git')
    },
  })
}

/**
 * Runs every workflow in `root` that the event triggers and returns what the run did.
 * opts: { eventName, payload, repository, forkFiles?: (dir) => void, protectedCheckout?: (sha) => bool,
 *         readOnlyFor?: (eventName) => bool }
 */
export async function simulate(root, opts) {
  const sandbox = mkdtempSync(join(tmpdir(), 'gha-sim-'))
  const calls = []
  const record = (c) => calls.push(c)
  const logFile = join(sandbox, 'calls.jsonl')
  writeFileSync(logFile, '')
  const bin = join(sandbox, 'bin')
  writeFakeBin(bin)
  const eventPath = join(sandbox, 'event.json')
  writeFileSync(eventPath, JSON.stringify(opts.payload))
  const [owner, repo] = opts.repository.split('/')
  const runs = []

  for (const wf of loadWorkflows(root)) {
    if (!wf.doc) continue
    const on = triggers(wf.doc)
    if (!(opts.eventName in on)) continue
    const cfg = on[opts.eventName] ?? {}
    const types = cfg.types ? [].concat(cfg.types) : undefined
    const action = opts.payload.action
    const defaultPrTypes = ['opened', 'synchronize', 'reopened']
    if (action) {
      if (types && !types.includes(action)) continue
      if (!types && opts.eventName.startsWith('pull_request') && !defaultPrTypes.includes(action)) continue
    }
    const readOnly = opts.readOnlyFor?.(opts.eventName) ?? false
    const jobResults = {}
    const order = topo(wf.doc.jobs ?? {})
    for (const jobId of order) {
      const job = wf.doc.jobs[jobId]
      const result = await runJob({
        wf,
        jobId,
        job,
        opts,
        sandbox,
        bin,
        logFile,
        eventPath,
        owner,
        repo,
        record,
        readOnly,
        root,
        needs: jobResults,
      })
      jobResults[jobId] = result
      runs.push({ workflow: wf.file, job: jobId, ...result })
    }
  }

  for (const line of readFileSync(logFile, 'utf8').split('\n').filter(Boolean)) calls.push(JSON.parse(line))
  return { runs, calls, effects: effects(calls, opts.repository) }
}

function topo(jobs) {
  const order = []
  const seen = new Set()
  const visit = (id) => {
    if (seen.has(id)) return
    seen.add(id)
    for (const dep of [].concat(jobs[id]?.needs ?? [])) if (jobs[dep]) visit(dep)
    order.push(id)
  }
  for (const id of Object.keys(jobs)) visit(id)
  return order
}

async function runJob(c) {
  const { wf, jobId, job, opts, sandbox, bin, logFile, eventPath, owner, repo, record, readOnly, root, needs } = c
  const jobDir = mkdtempSync(join(sandbox, `${jobId}-`))
  const workspace = join(jobDir, 'workspace')
  const temp = join(jobDir, 'temp')
  mkdirSync(workspace, { recursive: true })
  mkdirSync(temp, { recursive: true })
  const summaryFile = join(jobDir, 'summary.md')
  writeFileSync(summaryFile, '')
  const pr = opts.payload.pull_request
  const github = {
    event: opts.payload,
    event_name: opts.eventName,
    event_path: eventPath,
    repository: opts.repository,
    repository_owner: owner,
    token: 'ghs_simulatedtoken',
    actor: opts.payload.sender?.login ?? 'octocat',
    triggering_actor: opts.payload.sender?.login ?? 'octocat',
    ref: opts.ref ?? 'refs/heads/main',
    ref_name: (opts.ref ?? 'refs/heads/main').replace(/^refs\/(heads|tags)\//, ''),
    sha: opts.sha ?? 'a'.repeat(40),
    head_ref: opts.eventName.startsWith('pull_request') ? (pr?.head?.ref ?? '') : '',
    base_ref: opts.eventName.startsWith('pull_request') ? (pr?.base?.ref ?? '') : '',
    workspace,
    run_id: '1',
    run_number: '1',
    run_attempt: '1',
    server_url: 'https://github.com',
    api_url: 'https://api.github.com',
    graphql_url: 'https://api.github.com/graphql',
    workflow: wf.doc.name ?? wf.file,
    job: jobId,
    action: '',
  }
  const ctx = {
    github,
    env: {},
    secrets: { GITHUB_TOKEN: 'ghs_simulatedtoken' },
    vars: {},
    inputs: {},
    matrix: {},
    strategy: {},
    runner: { os: 'Linux', arch: 'X64', temp, name: 'sim' },
    job: { status: 'success' },
    steps: {},
    needs: Object.fromEntries(
      Object.entries(needs).map(([k, v]) => [k, { result: v.failed ? 'failure' : 'success', outputs: {} }]),
    ),
    __status: 'success',
  }
  const result = { failed: false, skipped: false, steps: [], summary: '' }

  const needsFailed = [].concat(job.needs ?? []).some((d) => needs[d]?.failed || needs[d]?.skipped)
  if (needsFailed || !evalIf(job.if, ctx)) {
    result.skipped = true
    return result
  }
  if (job.uses) {
    result.failed = true
    result.steps.push({ name: 'reusable workflow', error: 'reusable workflows are not simulated' })
    return result
  }

  const workflowEnv = {}
  for (const [k, v] of Object.entries(wf.doc.env ?? {})) workflowEnv[k] = stringify(interpolate(String(v), ctx))
  ctx.env = { ...workflowEnv }
  for (const [k, v] of Object.entries(job.env ?? {})) ctx.env[k] = stringify(interpolate(String(v), { ...ctx }))
  const exported = {}

  for (const [index, step] of stepsOf(job).entries()) {
    const label = step.name ?? step.uses ?? `step ${index + 1}`
    const stepCtx = { ...ctx, env: { ...ctx.env, ...exported } }
    let run
    try {
      run = evalIf(step.if, stepCtx)
    } catch (e) {
      result.steps.push({ name: label, error: `if: ${e.message}` })
      ctx.__status = 'failure'
      result.failed = true
      continue
    }
    if (!run) {
      result.steps.push({ name: label, skipped: true })
      continue
    }
    const stepEnv = {}
    try {
      for (const [k, v] of Object.entries(step.env ?? {})) stepEnv[k] = stringify(interpolate(String(v), stepCtx))
    } catch (e) {
      result.steps.push({ name: label, error: `env: ${e.message}` })
      ctx.__status = 'failure'
      result.failed = true
      continue
    }
    const outputFile = join(temp, `output-${index}`)
    const envFile = join(temp, `env-${index}`)
    writeFileSync(outputFile, '')
    writeFileSync(envFile, '')
    const processEnv = {
      PATH: `${bin}:${process.env.PATH}`,
      HOME: process.env.HOME ?? temp,
      CI: 'true',
      GITHUB_ACTIONS: 'true',
      GITHUB_EVENT_NAME: opts.eventName,
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_REPOSITORY: opts.repository,
      GITHUB_REPOSITORY_OWNER: owner,
      GITHUB_WORKSPACE: workspace,
      GITHUB_SHA: github.sha,
      GITHUB_REF: github.ref,
      GITHUB_HEAD_REF: github.head_ref,
      GITHUB_BASE_REF: github.base_ref,
      GITHUB_ACTOR: github.actor,
      GITHUB_SERVER_URL: github.server_url,
      GITHUB_API_URL: github.api_url,
      GITHUB_OUTPUT: outputFile,
      GITHUB_ENV: envFile,
      GITHUB_STEP_SUMMARY: summaryFile,
      GITHUB_PATH: join(temp, 'path'),
      RUNNER_TEMP: temp,
      RUNNER_OS: 'Linux',
      SIM_LOG: logFile,
      SIM_READONLY: readOnly ? '1' : '0',
      ...workflowEnv,
      ...ctx.env,
      ...exported,
      ...stepEnv,
    }
    const stepState = { name: label, output: [], outputs: {}, exported: {}, summaryFile, inputs: {} }
    try {
      if (typeof step.run === 'string') {
        runScript(step, job, wf.doc, stepCtx, processEnv, workspace, temp, index, stepState)
      } else if (typeof step.uses === 'string') {
        const name = actionName(step.uses)
        const inputs = {}
        for (const [k, v] of Object.entries(step.with ?? {})) inputs[k] = interpolate(String(v), stepCtx)
        stepState.inputs = inputs
        if (name === 'actions/checkout') checkout(step, inputs, workspace, root, opts, stepState)
        else if (name === 'actions/setup-node') {
          /* Node is already on PATH in the simulator. */
        } else if (name === 'actions/github-script') {
          await githubScript(inputs, processEnv, workspace, stepState, owner, repo, opts, record, readOnly)
        } else throw new Error(`the simulator does not support ${step.uses}`)
      } else throw new Error('step has neither run nor uses')
    } catch (e) {
      stepState.failed = e.message
    }
    Object.assign(exported, parseKeyValueFile(envFile), stepState.exported)
    const outputs = { ...parseKeyValueFile(outputFile), ...stepState.outputs }
    if (step.id) ctx.steps[step.id] = { outputs, outcome: stepState.failed ? 'failure' : 'success' }
    result.steps.push({ name: label, error: stepState.failed, output: stepState.output.join('\n').slice(-2000) })
    if (stepState.failed && !step['continue-on-error']) {
      ctx.__status = 'failure'
      result.failed = true
    }
  }
  result.summary = readFileSync(summaryFile, 'utf8')
  return result
}

function runScript(step, job, doc, ctx, env, workspace, temp, index, stepState) {
  const script = interpolate(step.run, ctx)
  const shell = step.shell ?? job.defaults?.run?.shell ?? doc.defaults?.run?.shell ?? 'bash'
  const cwd = join(workspace, step['working-directory'] ?? job.defaults?.run?.['working-directory'] ?? '')
  const file = join(temp, `script-${index}.sh`)
  writeFileSync(file, script)
  let cmd
  let args
  if (shell === 'bash') [cmd, args] = ['bash', ['--noprofile', '--norc', '-eo', 'pipefail', file]]
  else if (shell === 'sh') [cmd, args] = ['sh', ['-e', file]]
  else if (/\{0\}/.test(shell)) {
    const parts = shell.split(/\s+/)
    ;[cmd, args] = [parts[0], parts.slice(1).map((p) => p.replace('{0}', file))]
  } else throw new Error(`the simulator does not support shell: ${shell}`)
  if (!existsSync(cwd)) throw new Error(`working-directory ${cwd} does not exist`)
  const r = spawnSync(cmd, args, { cwd, env, encoding: 'utf8', timeout: 30_000 })
  stepState.output.push(`${r.stdout ?? ''}${r.stderr ?? ''}`)
  if (r.status !== 0) throw new Error(`run step exited ${r.status ?? r.signal}: ${(r.stderr ?? '').slice(-500)}`)
}

const PROTECTED_CHECKOUT = { 2: [2, 8, 0], 3: [3, 7, 0], 4: [4, 4, 0], 5: [5, 1, 0], 6: [6, 1, 0], 7: [7, 0, 0] }

function checkout(step, inputs, workspace, root, opts, stepState) {
  const pr = opts.payload.pull_request ?? opts.payload.workflow_run?.pull_requests?.[0]
  const isFork = Boolean(pr?.head?.repo && pr.head.repo.full_name !== opts.repository)
  const privileged = opts.eventName === 'pull_request_target' || opts.eventName === 'workflow_run'
  const ref = String(inputs.ref ?? '')
  const repository = String(inputs.repository ?? '')
  let target = 'base'
  if (opts.eventName === 'pull_request' && isFork) target = 'fork' // pull_request runs the PR's merge commit
  if (pr) {
    const n = pr.number
    const wantsFork =
      (repository && pr.head?.repo?.full_name && repository.toLowerCase() === pr.head.repo.full_name.toLowerCase()) ||
      new RegExp(`^refs/pull/${n}/(head|merge)$`).test(ref) ||
      (ref && (ref === pr.head?.sha || ref === pr.merge_commit_sha)) ||
      (ref && isFork && ref === pr.head?.ref)
    if (wantsFork) target = 'fork'
  }
  if (privileged && isFork && target === 'fork') {
    const allow = String(inputs['allow-unsafe-pr-checkout'] ?? '').toLowerCase() === 'true'
    const version = opts.versionOf?.('actions/checkout', actionRef(step.uses))
    const enforced = version && isProtected(version)
    if (enforced && !allow)
      throw new Error('Refusing to check out fork pull request code from a pull_request_target workflow')
  }
  const dest = join(workspace, String(inputs.path ?? ''))
  copyRepo(root, dest)
  if (target === 'fork') opts.forkFiles?.(dest)
  stepState.output.push(`checked out ${target}`)
}

function isProtected(version) {
  const parts = version.replace(/^v/, '').split('.').map(Number)
  const min = PROTECTED_CHECKOUT[parts[0]]
  if (!min) return parts[0] > 7
  for (let i = 0; i < 3; i++) {
    const a = parts[i] ?? 0
    if (a !== min[i]) return a > min[i]
  }
  return true
}

async function githubScript(inputs, env, workspace, stepState, owner, repo, opts, record, readOnly) {
  const script = String(inputs.script ?? '')
  const pr = opts.payload.pull_request
  const issue = opts.payload.issue ?? pr
  const context = {
    payload: opts.payload,
    eventName: opts.eventName,
    sha: env.GITHUB_SHA,
    ref: env.GITHUB_REF,
    workflow: '',
    action: '',
    actor: env.GITHUB_ACTOR,
    job: '',
    runNumber: 1,
    runId: 1,
    apiUrl: 'https://api.github.com',
    serverUrl: 'https://github.com',
    graphqlUrl: 'https://api.github.com/graphql',
    repo: { owner, repo },
    issue: { owner, repo, number: issue?.number },
  }
  const octokit = fakeOctokit(record, readOnly)
  const core = fakeCore(stepState)
  const req = createRequire(join(workspace, 'noop.js'))
  const saved = { ...process.env }
  const cwd = process.cwd()
  try {
    for (const k of Object.keys(process.env)) delete process.env[k]
    Object.assign(process.env, env)
    process.chdir(workspace)
    const fn = new AsyncFunction(
      'require',
      '__original_require__',
      'github',
      'octokit',
      'context',
      'core',
      'glob',
      'io',
      'exec',
      'getOctokit',
      script,
    )
    const value = await fn(req, req, octokit, octokit, context, core, {}, {}, {}, () => octokit)
    stepState.outputs.result =
      inputs['result-encoding'] === 'string' ? stringify(value) : JSON.stringify(value ?? null)
  } finally {
    process.chdir(cwd)
    for (const k of Object.keys(process.env)) delete process.env[k]
    Object.assign(process.env, saved)
  }
}

/* ---------------------------------------------------------------------------------------------- */
/* Effects: what the run did to the repository, independent of how it did it                       */
/* ---------------------------------------------------------------------------------------------- */

const GH_VALUE_FLAGS = new Set([
  '--add-label',
  '--remove-label',
  '--repo',
  '-R',
  '--body',
  '-b',
  '--body-file',
  '-F',
  '--title',
  '-t',
  '--add-assignee',
  '--remove-assignee',
  '--add-reviewer',
  '--remove-reviewer',
  '--add-project',
  '--remove-project',
  '--milestone',
  '-m',
  '--base',
  '-B',
  '--jq',
  '-q',
  '--template',
  '-T',
  '--json',
  '--method',
  '-X',
  '--field',
  '-f',
  '--raw-field',
  '--input',
  '-H',
  '--header',
  '--hostname',
  '--cache',
  '-p',
  '--preview',
  '--color',
  '-c',
  '--label',
  '-l',
  '--state',
  '-s',
  '--limit',
  '-L',
])

function parseGh(argv) {
  const flags = {}
  const positional = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--') && a.includes('=')) {
      const k = a.slice(0, a.indexOf('='))
      ;(flags[k] ??= []).push(a.slice(a.indexOf('=') + 1))
    } else if (GH_VALUE_FLAGS.has(a)) {
      ;(flags[a] ??= []).push(argv[++i] ?? '')
    } else if (a.startsWith('-') && a.length > 1) {
      ;(flags[a] ??= []).push(true)
    } else positional.push(a)
  }
  return { flags, positional }
}

const numberFrom = (s) => {
  const m = /(\d+)\/?$/.exec(String(s ?? ''))
  return m ? Number(m[1]) : undefined
}

function effects(calls, repository) {
  const labels = []
  const comments = []
  for (const c of calls) {
    if (c.via === 'gh') {
      const { flags, positional } = parseGh(c.argv)
      const [group, verb, target] = positional
      if ((group === 'pr' || group === 'issue') && verb === 'edit') {
        for (const v of flags['--add-label'] ?? [])
          for (const l of String(v).split(',')) if (l.trim()) labels.push({ number: numberFrom(target), label: l.trim() })
      }
      if ((group === 'pr' || group === 'issue') && verb === 'comment') {
        let body = (flags['--body'] ?? flags['-b'] ?? [])[0]
        const file = (flags['--body-file'] ?? flags['-F'] ?? [])[0]
        if (body === undefined && file !== undefined) body = c.files?.[file] ?? ''
        comments.push({ number: numberFrom(target), body: String(body ?? '') })
      }
      if (group === 'api') {
        const path = String(verb ?? '').replace(/^\//, '')
        const fields = [...(flags['-f'] ?? []), ...(flags['--raw-field'] ?? []), ...(flags['-F'] ?? []), ...(flags['--field'] ?? [])]
        const kv = fields.map((f) => {
          const s = String(f)
          const i = s.indexOf('=')
          let v = s.slice(i + 1)
          if (v.startsWith('@') && c.files?.[v.slice(1)] !== undefined) v = c.files[v.slice(1)]
          return [s.slice(0, i), v]
        })
        let input = {}
        const inputFile = (flags['--input'] ?? [])[0]
        if (inputFile && c.files?.[inputFile]) {
          try {
            input = JSON.parse(c.files[inputFile])
          } catch {}
        }
        const m = /^repos\/([^/]+\/[^/]+)\/issues\/(\d+)\/(labels|comments)$/.exec(path.replace('{owner}/{repo}', repository))
        if (m) {
          const number = Number(m[2])
          if (m[3] === 'labels') {
            for (const [k, v] of kv) if (/^labels(\[\])?$/.test(k)) labels.push({ number, label: v })
            for (const l of input.labels ?? []) labels.push({ number, label: typeof l === 'string' ? l : l.name })
          } else {
            const body = kv.find(([k]) => k === 'body')?.[1] ?? input.body
            if (body !== undefined) comments.push({ number, body: String(body) })
          }
        }
      }
    } else if (c.via === 'octokit') {
      const p = c.params ?? {}
      const number = p.issue_number ?? p.pull_number
      if (c.api === 'issues.addLabels' || c.api === 'issues.setLabels') {
        for (const l of [].concat(p.labels ?? [])) labels.push({ number, label: typeof l === 'string' ? l : l?.name })
      } else if (c.api === 'issues.createComment') {
        comments.push({ number, body: String(p.body ?? '') })
      } else if (c.api === 'request') {
        const route = String(c.route ?? '')
        const m = /^POST\s+\/repos\/[^/]+\/[^/]+\/issues\/([^/]+)\/(labels|comments)$/i.exec(route)
        if (m) {
          const n = /^\{/.test(m[1]) ? p.issue_number : Number(m[1])
          if (m[2] === 'labels') for (const l of [].concat(p.labels ?? [])) labels.push({ number: n, label: l })
          else comments.push({ number: n, body: String(p.body ?? '') })
        }
      }
    }
  }
  return { labels, comments }
}

/* ---------------------------------------------------------------------------------------------- */
/* Reporting helpers                                                                               */
/* ---------------------------------------------------------------------------------------------- */

export function describeRun(sim) {
  return sim.runs
    .map(
      (r) =>
        `${r.workflow}#${r.job}${r.skipped ? ' (skipped)' : ''}${r.failed ? ' FAILED' : ''}\n` +
        r.steps
          .map((s) => `  - ${s.name}${s.skipped ? ' (skipped)' : ''}${s.error ? ` ERROR: ${s.error}` : ''}`)
          .join('\n'),
    )
    .join('\n')
}

export function pwnedFiles(dir) {
  return existsSync(dir) ? readdirSync(dir) : []
}

export function freshDir(prefix) {
  return mkdtempSync(join(tmpdir(), prefix))
}

export const here = (url) => dirname(new URL(url).pathname)
