/**
 * Credential redaction for everything the lab writes: traces, raw transcripts, proxy logs, manifests.
 *
 * Two layers: exact values the lab knows are secret (the auth token, this run's honeytokens) and
 * shape-based patterns for credentials the agent might surface on its own. Patterns err on the side
 * of redacting: a trace with a few extra `[redacted]` markers is fine, a leaked key is not.
 */

const PATTERNS: readonly [label: string, re: RegExp][] = [
  [
    'private-key',
    /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g,
  ],
  ['anthropic-key', /\bsk-ant-[A-Za-z0-9_-]{16,}/g],
  ['openai-key', /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}/g],
  ['aws-access-key', /\b(?:AKIA|ASIA|AGPA|AIDA|AROA|ANPA)[A-Z0-9]{16}\b/g],
  [
    'aws-secret',
    /(aws_secret_access_key|secret_access_key|AWS_SECRET_ACCESS_KEY)(\s*[=:]\s*["']?)[A-Za-z0-9/+=]{40}/g,
  ],
  ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{22,255})\b/g],
  ['gitlab-token', /\bglpat-[A-Za-z0-9_-]{20,}\b/g],
  ['slack-token', /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g],
  ['stripe-key', /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g],
  ['google-key', /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ['npm-token', /\bnpm_[A-Za-z0-9]{36}\b/g],
  ['jwt', /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g],
  ['url-credentials', /\b([a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+:[^/\s@]+@/gi],
  ['bearer', /\b(Bearer\s+)[A-Za-z0-9._~+/-]{20,}=*/g],
  [
    'assignment',
    /\b([A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API_KEY|APIKEY|PRIVATE_KEY|CREDENTIALS?)[A-Z0-9_]*)(\s*[=:]\s*["']?)(?!\[redacted)[^\s"']{8,}/g,
  ],
]

export type Redactor = (text: string) => string

/**
 * Builds a redactor. `known` holds exact secret values (auth token, honeytokens); they are replaced
 * first and in full, longest first, so a value that contains another value is never half-redacted.
 */
export function redactor(known: readonly string[] = []): Redactor {
  const exact = [...new Set(known.filter((k) => k.length >= 8))].sort((a, b) => b.length - a.length)
  return (text: string) => {
    let out = text
    for (const value of exact) out = out.split(value).join('[redacted]')
    for (const [label, re] of PATTERNS) {
      out = out.replace(re, (_match, g1: unknown, g2: unknown) => {
        // Keep a leading prefix group (e.g. `NAME=` or `https://`) so the redacted text stays readable.
        // Patterns without groups receive the match offset here, hence the type checks.
        const p1 = typeof g1 === 'string' ? g1 : ''
        const p2 = typeof g2 === 'string' ? g2 : ''
        if (label === 'url-credentials') return `${p1}[redacted]@`
        if (label === 'bearer') return `${p1}[redacted]`
        if (label === 'aws-secret' || label === 'assignment') return `${p1}${p2}[redacted:${label}]`
        return `[redacted:${label}]`
      })
    }
    return out
  }
}

/** Redacts every string inside a JSON-compatible value. */
export function redactDeep<T>(value: T, redact: Redactor): T {
  if (typeof value === 'string') return redact(value) as T
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, redact)) as T
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = redactDeep(v, redact)
    return out as T
  }
  return value
}
