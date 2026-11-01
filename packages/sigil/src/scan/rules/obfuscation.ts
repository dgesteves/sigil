import { decodeCandidates, normalizeUnicode, sanitize } from '../text.js'
import type { Hit } from '../types.js'
import { PIPE, SINK } from './patterns.js'
import { bumpSeverity, type FileRule, first, type LineRule, SEVERITY_ORDER, table } from './rule.js'

const DECODER = String.raw`(?:base64\s+(?:-\w*[dD]\w*|--decode)|b64decode|openssl\s+(?:enc\s+)?(?:-\w+\s+)*-(?:d|base64)\b|xxd\s+(?:-\w+\s+)*-r\w*|uudecode|\brev\b|gunzip|zcat|gzip\s+-\w*d|bzip2\s+-\w*d|xz\s+-\w*d|tr\s+['"]?(?:A-Za-z|a-zA-Z|a-z|A-Z)['"]?\s+['"]?(?:N-ZA-Mn-za-m|n-za-mN-ZA-M|n-za-m|N-ZA-M)['"]?)`

const DECODE_EXEC = [
  new RegExp(`${DECODER}[^\\n;]{0,120}?${PIPE}\\s*${SINK}`, 'i'),
  /\b(?:eval|exec|source)\s+["']?\$\([^)\n]{0,300}?\b(?:base64|xxd|openssl|rev|gunzip|zcat|uudecode)\b/i,
  /\b(?:ba|z|k)?sh\s+-c\s+["']?\$\([^)\n]{0,300}?\b(?:base64|xxd|openssl|rev|gunzip)\b/i,
  /\b(?:exec|eval|compile)\s*\([^\n]{0,80}?\b(?:b64decode|b32decode|b16decode|a85decode|b85decode|decodebytes|unhexlify|fromhex|decompress|codecs\.decode|rot_?13)\b/i,
  /\b(?:pickle|cPickle|marshal|dill|shelve)\.loads?\s*\([^\n]{0,120}?\b(?:b64decode|decodebytes|unhexlify|fromhex|decompress|urlopen|requests\.get|recv|\.content\b|\.read\(\))/i,
  /\b(?:eval|Function|setTimeout|setInterval|execSync|exec)\s*\(\s*(?:new\s+)?[^\n]{0,40}?\b(?:atob|Buffer\.from\s*\([^)]{0,200}?['"](?:base64|hex)['"]|fromCharCode|unescape)\b/i,
  /\bnew\s+Function\s*\([^\n]{0,80}?\b(?:atob|Buffer\.from|fromCharCode)\b/i,
  /(?:FromBase64String)[^\n]{0,200}?\b(?:iex|Invoke-Expression|Invoke-Command|\.Invoke\(\))|\b(?:iex|Invoke-Expression)\b[^\n]{0,200}?FromBase64String/i,
  /\beval\s*\(?\s*(?:Base64\.(?:decode64|strict_decode64|urlsafe_decode64)|\[[^\]]+\]\.pack\(['"]m)/i,
  /\b(?:eval|assert)\s*\(\s*(?:base64_decode|gzinflate|gzuncompress|str_rot13|hex2bin|convert_uudecode)\s*\(/i,
]

export const decodeAndExecute: LineRule = {
  scope: 'line',
  id: 'SIG-SEC-010',
  name: 'decode-and-execute',
  family: 'obfuscation',
  title: 'Decodes data and executes the result',
  owasp: 'AST01',
  severity: 'critical',
  suppressible: true,
  table: table('critical', 'critical', 'high', 'medium'),
  message:
    'decodes an encoded payload and executes it: the command that runs is invisible to a reader',
  help: '`echo … | base64 -d | bash`, `eval "$(… | xxd -r -p)"`, `exec(b64decode(…))`, `eval(atob(…))` and `pickle.loads(…)` on decoded or remote data exist to hide what runs. This is the ClawHavoc dropper shape, and Tencent Zhuque Lab\'s remote-pickle sample. Nothing legitimate in a skill needs it: ship the plain command.',
  falsePositives:
    'Security training material that shows the pattern inside a section about attacks is downgraded to medium; prefer describing it without a working decoder chain.',
  match(line) {
    return first(DECODE_EXEC, line.text)
  },
}

/** Decoded text that is suspicious even when no other rule fires on it. */
const DANGEROUS_DECODED =
  /\b(?:curl|wget|bash|sh\s+-c|\/bin\/(?:ba|z)?sh|powershell|iex|eval|exec|nc\s+-|ncat|\/dev\/tcp|chmod|osascript|python[0-9.]*\s+-c|rm\s+-rf)\b|https?:\/\//i

export const encodedPayload: FileRule = {
  scope: 'file',
  id: 'SIG-SEC-011',
  name: 'encoded-payload',
  family: 'obfuscation',
  title: 'Encoded blob that decodes to commands or URLs',
  owasp: 'AST08',
  severity: 'high',
  suppressible: true,
  help: "Base64, hex, `\\x` escapes and character-code arrays are decoded and the result is scanned with every rule. A blob that hides a command, a URL or another rule's pattern is a payload waiting for a decoder, and the LLM itself can be the decoder (OWASP AST08). Put the plain text in the file.",
  falsePositives:
    'Images, hashes, keys and JWT examples decode to binary or harmless JSON and are ignored. Encoded URLs in test data are reported at medium.',
  check(ctx) {
    const hits: Hit[] = []
    const inner = ctx.inner
    for (const l of ctx.file.lines) {
      if (l.virtual) continue
      for (const d of decodeCandidates(l.text)) {
        const found = inner ? inner(d.text) : []
        const worst = found.reduce(
          (w, h) =>
            SEVERITY_ORDER.indexOf(h.severity) > SEVERITY_ORDER.indexOf(w) ? h.severity : w,
          'info' as Hit['severity'],
        )
        const dangerous = found.length > 0 || DANGEROUS_DECODED.test(d.text)
        if (!dangerous) continue
        let severity: Hit['severity'] = found.length
          ? SEVERITY_ORDER.indexOf(worst) >= 3
            ? worst
            : 'high'
          : 'medium'
        if (l.kind === 'example') severity = 'low'
        else if (l.kind === 'reference') severity = bumpSeverity(severity, -1)
        hits.push({
          line: l.n,
          kind: l.kind,
          severity,
          message: `${d.encoding} blob decodes to "${sanitize(d.text, 90)}"${found.length ? ` (${[...new Set(found.map((f) => f.rule))].join(', ')})` : ''}`,
          snippet: l.raw,
        })
        for (const f of found) {
          hits.push({
            rule: f.rule,
            line: l.n,
            kind: l.kind,
            severity: l.kind === 'example' ? 'low' : f.severity,
            message: `${f.message} (inside a ${d.encoding} payload)`,
            snippet: l.raw,
          })
        }
      }
    }
    return hits
  },
}

const SENSITIVE_TOKENS =
  /\b(?:curl|wget|bash|zsh|sh|nc|ncat|python[0-9.]*|perl|base64|eval|exec|chmod|rm|sudo|osascript|powershell|iex|ssh|scp)\b/g
const SENSITIVE_API =
  /\b(?:eval|exec|execSync|system|popen|spawn|child_process|subprocess|curl|wget|bash|powershell|Invoke-Expression|DownloadString|base64|atob|b64decode|__import__|getattr|globals|require|fromCharCode|os\.system)\b|\/bin\/sh/

function tokens(s: string): Set<string> {
  return new Set(s.match(SENSITIVE_TOKENS) ?? [])
}

export const stringConstruction: LineRule = {
  scope: 'line',
  id: 'SIG-SEC-012',
  name: 'string-construction',
  family: 'obfuscation',
  title: 'Command or API name assembled to dodge pattern matching',
  owasp: 'AST08',
  severity: 'high',
  suppressible: true,
  table: table('high', 'high', 'medium', 'low'),
  message: 'assembles a command or API name from pieces so pattern matchers miss it',
  help: '`c\'\'url`, `c\\url`, IFS word-splitting, `$\'\\x63url\'`, `"ev" + "al"` and `getattr(os, "sys" + "tem")` produce a dangerous name only at run time. SkillCloak showed these rewrites defeat most marketplace scanners. Sigil undoes them before matching and reports the trick itself.',
  falsePositives:
    'Minified bundles can concatenate short strings; those are reported by SIG-SEC-083 as packed code.',
  match(line) {
    if (line.shell) {
      const before = tokens(normalizeUnicode(line.raw))
      const after = tokens(line.text)
      const hidden = [...after].filter((t) => !before.has(t))
      if (hidden.length)
        return [
          {
            index: 0,
            message: `writes "${hidden.join('", "')}" with quoting or escape tricks so pattern matchers miss it`,
          },
        ]
    }
    for (const m of line.text.matchAll(
      /(["'])([^"'\n]{1,16})\1(?:\s*(?:\+|\.)\s*(["'])[^"'\n]{1,16}\3){1,12}/g,
    )) {
      const pieces = [...m[0].matchAll(/(["'])([^"'\n]{1,16})\1/g)].map((p) => p[2] ?? '')
      const joined = pieces.join('')
      const named = SENSITIVE_API.exec(joined)
      if (named && !pieces.some((p) => p.includes(named[0])))
        return [
          { index: m.index ?? 0, message: `builds "${named[0]}" by concatenating string pieces` },
        ]
    }
    const join =
      /\[\s*((?:["'][^"'\n]{1,12}["']\s*,\s*){1,12}["'][^"'\n]{1,12}["'])\s*\]\s*\.join\(\s*["']{2}\s*\)/.exec(
        line.text,
      )
    if (join) {
      const pieces = [...(join[1] ?? '').matchAll(/["']([^"'\n]{1,12})["']/g)].map(
        (p) => p[1] ?? '',
      )
      const named = SENSITIVE_API.exec(pieces.join(''))
      if (named && !pieces.some((p) => p.includes(named[0])))
        return [
          {
            index: join.index,
            message: `builds "${named[0]}" by joining an array of string pieces`,
          },
        ]
    }
    const reflective =
      /\bgetattr\(\s*(?:__builtins__|builtins|os|subprocess|importlib)\s*,\s*["'][^"']*["']\s*\+|\b(?:globalThis|window|global|self)\[\s*["'][^"']*["']\s*\+/.exec(
        line.text,
      )
    if (reflective)
      return [
        { index: reflective.index, message: 'looks up a function by a name assembled at run time' },
      ]
    return []
  },
}

export const OBFUSCATION_RULES = [decodeAndExecute, encodedPayload, stringConstruction] as const
