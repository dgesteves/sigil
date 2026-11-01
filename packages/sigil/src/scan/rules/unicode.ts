import { CONFUSABLES, foldConfusables, printable, sanitize } from '../text.js'
import type { Hit, Line, LocationKind } from '../types.js'
import type { FileContext, FileRule } from './rule.js'

/**
 * Unicode rules read the original text, line by line: normalisation would erase exactly what they look for.
 * The location kind of each line still comes from the segmenter.
 */
function sourceLines(
  ctx: FileContext,
): { n: number; raw: string; kind: LocationKind; code: boolean }[] {
  const byLine = new Map<number, Line>()
  for (const l of ctx.file.lines) if (!l.virtual && !byLine.has(l.n)) byLine.set(l.n, l)
  return ctx.file.text.split('\n').map((raw, i) => {
    const l = byLine.get(i + 1)
    return { n: i + 1, raw, kind: l?.kind ?? 'reference', code: l?.code ?? false }
  })
}

const TAG_RUN = /[\u{E0000}-\u{E007F}]+/gu

export const tagSmuggling: FileRule = {
  scope: 'file',
  id: 'SIG-SEC-020',
  name: 'unicode-tag-smuggling',
  family: 'unicode',
  title: 'Hidden text in Unicode tag characters (ASCII smuggling)',
  owasp: 'AST04',
  severity: 'critical',
  suppressible: false,
  help: 'Characters U+E0000–U+E007F mirror ASCII but render as nothing, so a line can carry instructions only the model reads. Snyk\'s ToxicSkills samples hid a "Prerequisites" payload this way. Sigil decodes and shows the hidden text. This rule cannot be suppressed.',
  falsePositives:
    'Emoji subdivision flags (England, Scotland, Wales) use tag characters after U+1F3F4 and are ignored.',
  check(ctx) {
    const hits: Hit[] = []
    for (const l of sourceLines(ctx)) {
      for (const m of l.raw.matchAll(TAG_RUN)) {
        const run = m[0]
        const before = l.raw.slice(Math.max(0, (m.index ?? 0) - 2), m.index)
        if (
          before.endsWith('\u{1F3F4}') &&
          /^[\u{E0030}-\u{E0039}\u{E0061}-\u{E007A}]{2,7}\u{E007F}$/u.test(run)
        )
          continue
        const hidden = [...run]
          .map((c) => String.fromCharCode((c.codePointAt(0) ?? 0xe0000) - 0xe0000))
          .join('')
        hits.push({
          line: l.n,
          kind: l.kind,
          severity: 'critical',
          message: `hides ${[...run].length} invisible tag characters that decode to "${sanitize(hidden, 120)}"`,
          snippet: l.raw,
        })
      }
    }
    return hits
  },
}

const OVERRIDES = /[‭‮]/
const EMBEDS = /[‪-‬⁦-⁩]/
const RTL_TEXT = /[\p{Script=Hebrew}\p{Script=Arabic}\p{Script=Syriac}\p{Script=Thaana}]/u

export const bidiControl: FileRule = {
  scope: 'file',
  id: 'SIG-SEC-021',
  name: 'bidi-control',
  family: 'unicode',
  title: 'Bidirectional control characters that reorder text (Trojan Source)',
  owasp: 'AST04',
  severity: 'high',
  suppressible: true,
  help: 'Right-to-left overrides and isolates make text display in a different order from how it is read by a parser or a model (CVE-2021-42574, "Trojan Source"). A reviewer sees one command; the agent gets another.',
  falsePositives:
    'Isolates in genuine right-to-left prose (Hebrew, Arabic) are reported at low. Overrides are always high.',
  check(ctx) {
    const hits: Hit[] = []
    for (const l of sourceLines(ctx)) {
      if (OVERRIDES.test(l.raw)) {
        hits.push({
          line: l.n,
          kind: l.kind,
          severity: 'high',
          message:
            'contains a right-to-left or left-to-right override that reorders what a reviewer sees',
          snippet: l.raw,
        })
      } else if (EMBEDS.test(l.raw)) {
        const severity =
          l.kind === 'script' || l.code ? 'high' : RTL_TEXT.test(l.raw) ? 'low' : 'medium'
        hits.push({
          line: l.n,
          kind: l.kind,
          severity,
          message: 'contains bidirectional embedding or isolate controls',
          snippet: l.raw,
        })
      }
    }
    return hits
  },
}

// biome-ignore lint/suspicious/noMisleadingCharacterClass: matching each zero-width mark individually is the point
const ZERO_WIDTH = /[​‌‍⁠-⁤﻿᠎͏ᅟᅠㅤﾠ឴឵­]/u
const JOINING_SCRIPTS =
  /[\p{Script=Arabic}\p{Script=Devanagari}\p{Script=Bengali}\p{Script=Gurmukhi}\p{Script=Gujarati}\p{Script=Oriya}\p{Script=Tamil}\p{Script=Telugu}\p{Script=Kannada}\p{Script=Malayalam}\p{Script=Sinhala}\p{Script=Khmer}\p{Script=Myanmar}\p{Script=Syriac}\p{Script=Mongolian}]/u
// biome-ignore lint/suspicious/noMisleadingCharacterClass: matching the pictograph and its modifiers individually is the point
const PICTOGRAPH = /[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}️♀♂⚕⚖✈❤]/u

export const zeroWidth: FileRule = {
  scope: 'file',
  id: 'SIG-SEC-022',
  name: 'zero-width-characters',
  family: 'unicode',
  title: 'Zero-width or invisible characters',
  owasp: 'AST04',
  severity: 'high',
  suppressible: true,
  help: 'Zero-width spaces, joiners and fillers are invisible. Inside a word they break pattern matching (`cu​rl`); in runs they encode hidden data bit by bit. Sigil removes them before matching other rules and reports where they are.',
  falsePositives:
    'Joiners inside emoji sequences and in scripts that need them (Arabic, Persian, Indic) are ignored. A stray zero-width space pasted into prose is reported at low.',
  check(ctx) {
    const hits: Hit[] = []
    for (const l of sourceLines(ctx)) {
      const chars = [...l.raw]
      let run = 0
      let longest = 0
      let inWord = 0
      let count = 0
      chars.forEach((c, i) => {
        if (i === 0 && l.n === 1 && c === '﻿') return
        if (!ZERO_WIDTH.test(c)) {
          run = 0
          return
        }
        const prev = chars[i - 1] ?? ''
        const next = chars[i + 1] ?? ''
        if ((c === '‍' || c === '️') && (PICTOGRAPH.test(prev) || PICTOGRAPH.test(next))) return
        if ((c === '‌' || c === '‍') && (JOINING_SCRIPTS.test(prev) || JOINING_SCRIPTS.test(next)))
          return
        count++
        run++
        longest = Math.max(longest, run)
        if (/[A-Za-z0-9_]/.test(prev) && /[A-Za-z0-9_]/.test(next)) inWord++
      })
      if (!count) continue
      let severity: Hit['severity'] = 'low'
      let message = `contains ${count} invisible zero-width character${count > 1 ? 's' : ''}`
      if (longest >= 4) {
        severity = 'high'
        message = `contains a run of ${longest} zero-width characters: enough to encode hidden data`
      } else if (inWord) {
        severity = l.kind === 'script' || l.kind === 'instruction' ? 'high' : 'medium'
        message = 'hides zero-width characters inside a word, which breaks pattern matching on it'
      }
      if (l.kind === 'example' && severity !== 'low') severity = 'medium'
      hits.push({ line: l.n, kind: l.kind, severity, message, snippet: l.raw })
    }
    return hits
  },
}

const VS_SUPPLEMENT = /[\u{E0100}-\u{E01EF}]/u
const VS_RUN = /[︀-️\u{E0100}-\u{E01EF}]{2,}/gu

export const variationSelectors: FileRule = {
  scope: 'file',
  id: 'SIG-SEC-023',
  name: 'variation-selector-smuggling',
  family: 'unicode',
  title: 'Data hidden in Unicode variation selectors',
  owasp: 'AST04',
  severity: 'critical',
  suppressible: false,
  help: 'The 256 variation selectors can encode one byte each after any visible character, so an emoji can carry a whole hidden message. Sigil decodes the bytes and shows them. This rule cannot be suppressed.',
  falsePositives:
    'A single U+FE0F or U+FE0E after an emoji or symbol is normal and ignored; so is a single ideographic variation selector after a CJK character.',
  check(ctx) {
    const hits: Hit[] = []
    for (const l of sourceLines(ctx)) {
      for (const m of l.raw.matchAll(VS_RUN)) {
        const run = [...m[0]]
        if (run.every((c) => c === '️' || c === '︎')) continue
        const supplement = run.some((c) => VS_SUPPLEMENT.test(c))
        if (!supplement && run.length < 3) continue
        const bytes = Buffer.from(
          run.map((c) => {
            const cp = c.codePointAt(0) ?? 0
            return cp >= 0xe0100 ? cp - 0xe0100 + 16 : cp - 0xfe00
          }),
        )
        const text = bytes.toString('utf8')
        const decoded = printable(text) ? ` that decode to "${sanitize(text, 100)}"` : ''
        hits.push({
          line: l.n,
          kind: l.kind,
          severity: run.length >= 8 ? 'critical' : 'high',
          message: `hides ${run.length} variation selectors${decoded}`,
          snippet: l.raw,
        })
      }
    }
    return hits
  },
}

const MIXABLE = new Set(
  Object.keys(CONFUSABLES).filter((c) =>
    /[\p{Script=Cyrillic}\p{Script=Greek}\p{Script=Armenian}]/u.test(c),
  ),
)
const SENSITIVE_WORDS =
  /^(?:curl|wget|bash|sh|zsh|sudo|ssh|scp|git|npm|npx|pnpm|yarn|pip|pip3|uv|uvx|python|python3|node|rm|chmod|chown|eval|exec|powershell|iex|base64|open|github|gitlab|google|microsoft|apple|anthropic|claude|openai|paypal|npmjs|pypi|vercel|amazon|aws|stripe|login|signin|secure|wallet|metamask)$/i
const TOKEN = /[\p{L}\p{N}_.\-/@:]+/gu
const FULLWIDTH = /[！-～]/

export const homoglyph: FileRule = {
  scope: 'file',
  id: 'SIG-SEC-024',
  name: 'homoglyph',
  family: 'unicode',
  title: 'Lookalike letters from another script in a command, name or host',
  owasp: 'AST04',
  severity: 'high',
  suppressible: true,
  help: 'Cyrillic `с` and Latin `c` look identical. Mixing scripts inside one word makes a command, package or domain look like another (`сurl`, `gіthub.com`), and slips past exact-match rules. SkillCloak used lookalike substitution against marketplace scanners. Sigil folds lookalikes before matching and reports them.',
  falsePositives:
    'Prose in Greek, Cyrillic or Armenian is not mixed-script and is ignored; Greek letters in maths ("α-helix") are only reported in code.',
  check(ctx) {
    const hits: Hit[] = []
    for (const l of sourceLines(ctx)) {
      // biome-ignore lint/suspicious/noControlCharactersInRegex: "any non-ASCII" necessarily spans the control range
      if (!/[^\u0000-\u007F]/.test(l.raw)) continue
      const codeLine = l.kind === 'script' || l.code
      for (const m of l.raw.matchAll(TOKEN)) {
        const tok = m[0]
        const chars = [...tok]
        const lookalikes = chars.filter((c) => MIXABLE.has(c))
        const fullwidth = codeLine && FULLWIDTH.test(tok)
        if (!lookalikes.length && !fullwidth) continue
        const ascii = chars.some((c) => /[A-Za-z]/.test(c))
        const folded = foldConfusables(tok.normalize('NFKC'))
        const inUrl = /\.[a-z]{2,}|:\/\//i.test(folded)
        const sensitive = folded.split(/[./@:-]/).some((part) => SENSITIVE_WORDS.test(part))
        if (!fullwidth && !ascii && !sensitive) continue
        if (!codeLine && !sensitive && !inUrl) continue
        const severity: Hit['severity'] =
          l.kind === 'example' || l.kind === 'reference'
            ? 'low'
            : codeLine || sensitive || inUrl
              ? 'high'
              : 'medium'
        hits.push({
          line: l.n,
          kind: l.kind,
          severity,
          message: `"${sanitize(tok, 40)}" mixes lookalike letters from another script; it reads as "${sanitize(folded, 40)}"`,
          snippet: l.raw,
        })
        break
      }
    }
    return hits
  },
}

export const terminalControl: FileRule = {
  scope: 'file',
  id: 'SIG-SEC-025',
  name: 'terminal-control-sequences',
  family: 'unicode',
  title: 'Terminal escape sequences or control characters in text',
  owasp: 'AST04',
  severity: 'high',
  suppressible: true,
  help: 'Raw ESC sequences and carriage returns rewrite what a terminal shows: `cat SKILL.md` or a diff can display a harmless line while the file holds another. Text files have no reason to contain them.',
  falsePositives:
    'Windows line endings (CR before LF) are ignored. Literal escape notation such as `\\033[31m` in scripts is text, not a control character, and is not reported.',
  check(ctx) {
    const hits: Hit[] = []
    const script = ctx.file.role === 'script'
    for (const l of sourceLines(ctx)) {
      const line = l.raw.endsWith('\r') ? l.raw.slice(0, -1) : l.raw
      // biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point
      if (/\u001b/.test(line)) {
        hits.push({
          line: l.n,
          kind: l.kind,
          severity: script ? 'medium' : 'high',
          message:
            'contains a raw terminal escape sequence that can hide or rewrite text when displayed',
          snippet: line,
        })
      } else if (line.includes('\r')) {
        hits.push({
          line: l.n,
          kind: l.kind,
          severity: 'medium',
          message: 'contains a carriage return mid-line: a terminal shows only the text after it',
          snippet: line,
        })
        // biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point
      } else if (/[\u0000-\u0008\u000E-\u001F\u007F]/.test(line)) {
        hits.push({
          line: l.n,
          kind: l.kind,
          severity: 'medium',
          message:
            'contains control characters (backspace, NUL or similar) that change how text displays',
          snippet: line,
        })
      }
    }
    return hits
  },
}

export const UNICODE_RULES = [
  tagSmuggling,
  bidiControl,
  zeroWidth,
  variationSelectors,
  homoglyph,
  terminalControl,
] as const
