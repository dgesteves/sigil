import { isMarkdown } from './filetype.js'
import { normalize, normalizeShell } from './text.js'
import type { FileRole, Line, LocationKind } from './types.js'

/** An HTML comment in markdown: the agent reads it, a human reading the rendered page never sees it. */
export interface CommentBlock {
  start: number
  end: number
  text: string
  unterminated: boolean
}

export interface Segmented {
  lines: Line[]
  comments: CommentBlock[]
  /** Last line of YAML frontmatter, 0 when there is none. */
  frontmatterEnd: number
}

const SHELL_LANGS = new Set([
  'bash',
  'sh',
  'shell',
  'zsh',
  'console',
  'terminal',
  'shell-session',
  'shellsession',
  'fish',
  'ksh',
  'cmd',
  'bat',
  'batch',
])

/**
 * Headings that turn their section into teaching material: code and quotes under "Red flags" or
 * "Attack patterns" show what to avoid, not what to do.
 */
export const EDUCATIONAL_HEADING =
  /\b(?:security|threats?|attacks?|attackers?|malicious|malware|exploits?|red[- ]flags?|warning signs?|anti-?patterns?|bad (?:examples?|practices?|patterns?)|don'?ts|what not to|pitfalls?|(?:common )?mistakes|unsafe|dangerous|insecure|vulnerab\w*|injections?|detections?|detecting|indicators?|iocs?|signatures?|(?:threat|attack) model|hardening|forbidden|prohibited|never do|avoid)\b/i

/** Lead-in lines right before a code block that mark it as a negative example. */
const NEGATIVE_LEADIN =
  /(?:\b(?:bad|wrong|incorrect|avoid|never|don'?t|do not|must not|unsafe|dangerous|malicious|insecure|vulnerable|attackers?|anti-?pattern|not this|instead of this|red flag|forbidden|blocked|flagged|detects?|looks like this)\b|❌|✗|✘|🚫|⛔|⚠)/i

/** A comment line inside a code block that starts a negative or a positive half of an example. */
const BAD_MARKER =
  /^\s*(?:#|\/\/|--|<!--|;|REM\b)\s*(?:\*\*)?(?:bad|wrong|incorrect|don'?t|do not|never|avoid|unsafe|dangerous|insecure|vulnerable|malicious|❌|✗|✘|🚫)/i
const GOOD_MARKER =
  /^\s*(?:#|\/\/|--|<!--|;|REM\b)\s*(?:\*\*)?(?:good|correct|right|better|instead|do this|safe|secure|preferred|recommended|✅|✓|✔)/i

const SUPPRESSION = /sigil-scan-ignore/

function mkLine(
  n: number,
  raw: string,
  kind: LocationKind,
  opts: Partial<Omit<Line, 'n' | 'raw' | 'kind' | 'text'>> = {},
): Line {
  const shell = opts.shell ?? false
  let text = normalize(raw)
  if (shell) text = normalizeShell(text).replace(/^\s*\$\s+/, '')
  return {
    n,
    raw,
    text,
    kind,
    concealed: opts.concealed ?? false,
    shell,
    code: opts.code ?? false,
    section: opts.section ?? '',
    ...(opts.virtual ? { virtual: opts.virtual } : {}),
  }
}

/** Joins shell continuation lines (`\` at end of line) so a command split across lines is matched whole. */
function joinContinuations(
  lines: string[],
  start: number,
  end: number,
): { n: number; raw: string }[] {
  const out: { n: number; raw: string }[] = []
  let i = start
  while (i < end) {
    let raw = lines[i] ?? ''
    const n = i + 1
    while (/\\\s*$/.test(raw) && i + 1 < end) {
      i++
      raw = `${raw.replace(/\\\s*$/, '')} ${(lines[i] ?? '').trim()}`
    }
    out.push({ n, raw })
    i++
  }
  return out
}

export function segment(
  path: string,
  text: string,
  role: FileRole,
  language: string | undefined,
): Segmented {
  if ((role === 'entry' || role === 'doc') && isMarkdown(path)) return segmentMarkdown(text, role)
  if (role === 'script')
    return { lines: segmentScript(text, language ?? 'shell'), comments: [], frontmatterEnd: 0 }
  if (role === 'config')
    return { lines: segmentConfig(text, path), comments: [], frontmatterEnd: 0 }
  if (language === 'html') return { lines: segmentHtml(text), comments: [], frontmatterEnd: 0 }
  const kind: LocationKind = role === 'entry' ? 'instruction' : 'reference'
  return {
    lines: text.split('\n').map((raw, i) => mkLine(i + 1, raw, kind)),
    comments: [],
    frontmatterEnd: 0,
  }
}

/* ------------------------------------------------------------------------------------------------
 * Markdown
 * ---------------------------------------------------------------------------------------------- */

function segmentMarkdown(text: string, role: FileRole): Segmented {
  const src = text.split('\n')
  const lines: Line[] = []
  const comments: CommentBlock[] = []
  const base: LocationKind = role === 'entry' ? 'instruction' : 'reference'
  const headings: string[] = []
  const sectionOf = () => headings.filter(Boolean).join(' > ')
  const educational = () => headings.some((h) => h && EDUCATIONAL_HEADING.test(h))
  const proseKind = (): LocationKind => (educational() ? 'example' : base)
  const closeComment = (c: { start: number; parts: string[] }, end: number) => {
    comments.push({ start: c.start, end, text: c.parts.join('\n'), unterminated: false })
  }

  let i = 0
  let frontmatterEnd = 0
  if (src[0]?.trim() === '---') {
    const close = src.findIndex((l, k) => k > 0 && /^(?:---|\.\.\.)\s*$/.test(l))
    if (close > 0) {
      frontmatterEnd = close + 1
      let inHooks = false
      for (let k = 1; k < close; k++) {
        const raw = src[k] ?? ''
        if (/^\S/.test(raw)) inHooks = /^hooks\s*:/.test(raw)
        lines.push(mkLine(k + 1, raw, 'instruction'))
        const cmd = /^\s*(?:-\s*)?command\s*:\s*(.+?)\s*$/.exec(raw)?.[1]
        if (inHooks && cmd) {
          lines.push(
            mkLine(k + 1, unquoteYaml(cmd), 'script', { shell: true, code: true, virtual: 'hook' }),
          )
        }
      }
      i = close + 1
    }
  }

  let fence:
    | { char: string; len: number; lang: string; kind: LocationKind; shell: boolean }
    | undefined
  let fenceExample = false
  let comment: { start: number; parts: string[] } | undefined
  const recentProse: string[] = []

  for (; i < src.length; i++) {
    const raw = src[i] ?? ''
    const n = i + 1

    if (fence) {
      const close = new RegExp(`^\\s{0,3}${fence.char === '`' ? '`' : '~'}{${fence.len},}\\s*$`)
      if (close.test(raw)) {
        fence = undefined
        continue
      }
      if (BAD_MARKER.test(raw)) fenceExample = true
      else if (GOOD_MARKER.test(raw)) fenceExample = false
      // Continuation lines inside shell blocks are joined; the joined line keeps the first line number.
      let joined = raw
      if (fence.shell) {
        while (/\\\s*$/.test(joined) && i + 1 < src.length && !close.test(src[i + 1] ?? '')) {
          i++
          joined = `${joined.replace(/\\\s*$/, '')} ${(src[i] ?? '').trim()}`
        }
      }
      const kind: LocationKind = fenceExample ? 'example' : fence.kind
      lines.push(mkLine(n, joined, kind, { shell: fence.shell, code: true, section: sectionOf() }))
      pushPreprocess(lines, n, joined, kind === 'example' ? 'example' : 'script', false)
      continue
    }

    if (comment) {
      const endAt = raw.indexOf('-->')
      if (endAt >= 0) {
        comment.parts.push(raw.slice(0, endAt))
        closeComment(comment, n)
        comment = undefined
        const rest = raw.slice(endAt + 3)
        if (rest.trim()) lines.push(mkLine(n, rest, proseKind(), { section: sectionOf() }))
      } else {
        comment.parts.push(raw)
        lines.push(mkLine(n, raw, base, { concealed: true, section: sectionOf() }))
        pushPreprocess(lines, n, raw, 'script', true)
      }
      continue
    }

    const open = /^(\s{0,3})(`{3,}|~{3,})\s*([^\s`]*)/.exec(raw)
    if (open) {
      const lang = (open[3] ?? '')
        .toLowerCase()
        .replace(/^\{?\.?/, '')
        .replace(/\}$/, '')
      const negativeLeadIn = recentProse.some((p) => NEGATIVE_LEADIN.test(p))
      const kind: LocationKind = educational() || negativeLeadIn ? 'example' : base
      fence = {
        char: open[2]![0]!,
        len: open[2]!.length,
        lang,
        kind,
        shell: SHELL_LANGS.has(lang) || (lang === '' && /^\s*\$\s/.test(src[i + 1] ?? '')),
      }
      fenceExample = false
      recentProse.length = 0
      continue
    }

    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(raw)
    if (heading) {
      const level = heading[1]!.length
      headings.length = level - 1
      headings[level - 1] = heading[2] ?? ''
      recentProse.length = 0
    }

    // HTML comments: split visible text from hidden text on the same line.
    let visible = raw
    let k = visible.indexOf('<!--')
    while (k >= 0) {
      const endAt = visible.indexOf('-->', k + 4)
      if (endAt < 0) {
        const hidden = visible.slice(k + 4)
        comment = { start: n, parts: [hidden] }
        visible = visible.slice(0, k)
        if (hidden.trim() && !SUPPRESSION.test(hidden)) {
          lines.push(mkLine(n, hidden, base, { concealed: true, section: sectionOf() }))
          pushPreprocess(lines, n, hidden, 'script', true)
        }
        break
      }
      const hidden = visible.slice(k + 4, endAt)
      comments.push({ start: n, end: n, text: hidden, unterminated: false })
      if (hidden.trim() && !SUPPRESSION.test(hidden)) {
        lines.push(mkLine(n, hidden, base, { concealed: true, section: sectionOf() }))
        pushPreprocess(lines, n, hidden, 'script', true)
      }
      visible = `${visible.slice(0, k)}${visible.slice(endAt + 3)}`
      k = visible.indexOf('<!--')
    }

    if (visible.trim() || !raw.trim()) {
      lines.push(mkLine(n, visible, proseKind(), { section: sectionOf() }))
      pushPreprocess(lines, n, visible, 'script', false)
    }
    if (visible.trim() && !heading) {
      recentProse.push(visible)
      if (recentProse.length > 2) recentProse.shift()
    }
  }

  if (comment) {
    comments.push({
      start: comment.start,
      end: src.length,
      text: comment.parts.join('\n'),
      unterminated: true,
    })
  }
  return { lines, comments, frontmatterEnd }
}

/** Claude Code runs `!`cmd`` in skills and commands before the model sees the text. */
function pushPreprocess(
  lines: Line[],
  n: number,
  raw: string,
  kind: LocationKind,
  concealed: boolean,
) {
  for (const m of raw.matchAll(/(?:^|[\s(>*-])!`([^`\n]+)`/g)) {
    lines.push(
      mkLine(n, m[1] ?? '', kind, { shell: true, code: true, concealed, virtual: 'preprocess' }),
    )
  }
}

function unquoteYaml(s: string): string {
  const t = s.trim()
  if (t.startsWith('"') && t.endsWith('"')) {
    try {
      return JSON.parse(t) as string
    } catch {
      return t.slice(1, -1)
    }
  }
  if (t.startsWith("'") && t.endsWith("'")) return t.slice(1, -1).replace(/''/g, "'")
  return t
}

/* ------------------------------------------------------------------------------------------------
 * Scripts
 * ---------------------------------------------------------------------------------------------- */

const HASH_COMMENT = new Set(['shell', 'python', 'ruby', 'perl', 'powershell', 'r'])
const SLASH_COMMENT = new Set(['js', 'c-like', 'php'])

function segmentScript(text: string, language: string): Line[] {
  const src = text.split('\n')
  const out: Line[] = []
  const shell = language === 'shell' || language === 'batch'
  const rows = shell
    ? joinContinuations(src, 0, src.length)
    : src.map((raw, i) => ({ n: i + 1, raw }))
  let block: 'c' | 'py' | 'ps' | undefined
  let pyQuote = ''

  for (const { n, raw } of rows) {
    const t = raw.trim()
    let comment = false
    if (block === 'c') {
      comment = true
      if (t.includes('*/')) block = undefined
    } else if (block === 'ps') {
      comment = true
      if (t.includes('#>')) block = undefined
    } else if (block === 'py') {
      comment = true
      if (t.includes(pyQuote)) block = undefined
    } else if (n === 1 && t.startsWith('#!')) {
      comment = true
    } else if (
      HASH_COMMENT.has(language) &&
      t.startsWith('#') &&
      !(language === 'powershell' && t.startsWith('#>'))
    ) {
      comment = true
      if (language === 'powershell' && t.startsWith('<#'))
        block = t.includes('#>') ? undefined : 'ps'
    } else if (language === 'powershell' && t.startsWith('<#')) {
      comment = true
      if (!t.includes('#>')) block = 'ps'
    } else if (
      SLASH_COMMENT.has(language) &&
      (t.startsWith('//') || t.startsWith('/*') || t.startsWith('*'))
    ) {
      comment = true
      if (t.startsWith('/*') && !t.includes('*/')) block = 'c'
    } else if (language === 'python') {
      // A string literal at statement start is a docstring. `exec("""…""")` is code and stays code.
      const doc = /^(?:[rRuUbBfF]{0,2})("""|''')/.exec(t)
      if (doc) {
        comment = true
        pyQuote = doc[1]!
        if (!t.slice(doc[0].length).includes(pyQuote)) block = 'py'
      }
    } else if (language === 'batch' && /^(?:rem\b|::)/i.test(t)) {
      comment = true
    } else if ((language === 'lua' || language === 'applescript') && t.startsWith('--')) {
      comment = true
    } else if (language === 'vbscript' && t.startsWith("'")) {
      comment = true
    }
    out.push(
      mkLine(n, raw, comment ? 'reference' : 'script', {
        shell: shell && !comment,
        code: !comment,
      }),
    )
  }
  return out
}

/* ------------------------------------------------------------------------------------------------
 * Config and data
 * ---------------------------------------------------------------------------------------------- */

const EXEC_KEY_JSON =
  /"(?:command|cmd|run|exec|script|shell|entrypoint|postCreateCommand|postStartCommand|apiKeyHelper)"\s*:/
const EXEC_KEY_YAML = /^\s*(?:-\s*)?(?:run|command|cmd|script|entrypoint)\s*:/
const EXEC_KEY_TOML = /^\s*(?:command|cmd|run|args)\s*=/

function segmentConfig(text: string, path: string): Line[] {
  const json = /\.json[c5]?$/i.test(path)
  const yaml = /\.ya?ml$/i.test(path)
  const toml = /\.toml$/i.test(path)
  return text.split('\n').map((raw, i) => {
    const exec =
      (json && EXEC_KEY_JSON.test(raw)) ||
      (yaml && EXEC_KEY_YAML.test(raw)) ||
      (toml && EXEC_KEY_TOML.test(raw))
    return mkLine(i + 1, raw, exec ? 'script' : 'reference', { shell: exec, code: true })
  })
}

function segmentHtml(text: string): Line[] {
  let inScript = false
  return text.split('\n').map((raw, i) => {
    if (/<script\b/i.test(raw))
      inScript = !/<\/script>/i.test(raw) || /<script\b[^>]*>[^<]+<\/script>/i.test(raw)
    const line = mkLine(i + 1, raw, inScript ? 'script' : 'reference', { code: inScript })
    if (/<\/script>/i.test(raw)) inScript = false
    return line
  })
}
