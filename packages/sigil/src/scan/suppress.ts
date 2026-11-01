/**
 * Inline suppressions: `sigil-scan-ignore SIG-SEC-001: <reason>` in a comment (`<!-- -->`, `#`, `//`),
 * on the line before the finding or at the end of the finding's own line. A reason is required, and
 * suppressed findings are kept as `info` with that reason: reviewers always see what was waved through.
 */
export interface Suppression {
  /** 1-based line the comment is on. */
  line: number
  /** Line the suppression applies to (the next code line, or the same line for a trailing comment). */
  target: number
  rules: string[]
  reason: string
}

export interface InvalidSuppression {
  line: number
  message: string
}

const MARKER = /(?:<!--|#|\/\/|\/\*|;|--|\bREM\b|::)\s*sigil-scan-ignore\b(.*)$/i
const IDS = /^\s+((?:SIG-SEC-\d{3})(?:\s*,\s*SIG-SEC-\d{3})*)\s*(?::\s*(.*?))?\s*(?:-->|\*\/)?\s*$/i
const FENCE = /^\s{0,3}(?:`{3,}|~{3,})/

export function parseSuppressions(source: string): {
  suppressions: Suppression[]
  invalid: InvalidSuppression[]
} {
  const lines = source.split('\n')
  const suppressions: Suppression[] = []
  const invalid: InvalidSuppression[] = []
  lines.forEach((raw, i) => {
    const m = MARKER.exec(raw)
    if (!m) return
    const n = i + 1
    const ids = IDS.exec(m[1] ?? '')
    if (!ids) {
      invalid.push({
        line: n,
        message:
          'sigil-scan-ignore needs rule ids and a reason: "sigil-scan-ignore SIG-SEC-001: why"',
      })
      return
    }
    const reason = (ids[2] ?? '').trim()
    if (reason.length < 3) {
      invalid.push({
        line: n,
        message: 'sigil-scan-ignore without a reason is ignored; say why the finding is safe',
      })
      return
    }
    const rules = ids[1]!.split(',').map((r) => r.trim().toUpperCase())
    const before = raw.slice(0, m.index).trim()
    // A trailing comment covers its own line; a comment on its own line covers the next code line.
    let target = n
    if (!before || before === '<!--') {
      let j = i + 1
      while (j < lines.length && (!(lines[j] ?? '').trim() || FENCE.test(lines[j] ?? ''))) j++
      target = j + 1
    }
    suppressions.push({ line: n, target, rules, reason })
  })
  return { suppressions, invalid }
}
