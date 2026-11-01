import { gunzipSync, inflateSync } from 'node:zlib'

/* ------------------------------------------------------------------------------------------------
 * Normalisation. Rules match on a normalised view of each line so that the evasion tricks that are
 * themselves flagged (homoglyphs, zero-width characters, quote splitting) cannot also hide the payload.
 * ---------------------------------------------------------------------------------------------- */

/** Zero-width, bidi, tag, variation-selector and other invisible code points. */
// biome-ignore lint/suspicious/noMisleadingCharacterClass: matching combining and invisible marks individually is the point
export const INVISIBLE_RE = /[­͏؜ᅟᅠ឴឵᠎​-‏‪-‮⁠-⁤⁦-⁩ㅤ︀-️﻿ﾠ]|[\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}]/gu

// biome-ignore lint/suspicious/noControlCharactersInRegex: matching terminal escapes is the point
const ANSI_RE = /\u001b(?:\[[0-9;?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)?|[@-Z\\-_])/g
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g

/** Lookalike letters from other scripts, folded to the ASCII letter they imitate. */
export const CONFUSABLES: Readonly<Record<string, string>> = {
  // Cyrillic
  а: 'a',
  е: 'e',
  ё: 'e',
  һ: 'h',
  і: 'i',
  ї: 'i',
  ј: 'j',
  о: 'o',
  р: 'p',
  с: 'c',
  ѕ: 's',
  у: 'y',
  х: 'x',
  ԁ: 'd',
  ԛ: 'q',
  ԝ: 'w',
  ӏ: 'l',
  А: 'A',
  В: 'B',
  Е: 'E',
  К: 'K',
  М: 'M',
  Н: 'H',
  О: 'O',
  Р: 'P',
  С: 'C',
  Т: 'T',
  Х: 'X',
  У: 'Y',
  І: 'I',
  Ј: 'J',
  Ѕ: 'S',
  Ԛ: 'Q',
  Ԝ: 'W',
  // Greek
  α: 'a',
  ο: 'o',
  ρ: 'p',
  ν: 'v',
  ι: 'i',
  κ: 'k',
  υ: 'u',
  χ: 'x',
  Α: 'A',
  Β: 'B',
  Ε: 'E',
  Ζ: 'Z',
  Η: 'H',
  Ι: 'I',
  Κ: 'K',
  Μ: 'M',
  Ν: 'N',
  Ο: 'O',
  Ρ: 'P',
  Τ: 'T',
  Υ: 'Y',
  Χ: 'X',
  // Armenian
  օ: 'o',
  ս: 'u',
  ո: 'n',
  // Latin lookalikes outside ASCII
  ı: 'i',
  ȷ: 'j',
  ɑ: 'a',
  ɡ: 'g',
}

const INVISIBLE_ONE = new RegExp(INVISIBLE_RE.source, 'u')

const CONFUSABLE_RE = new RegExp(`[${Object.keys(CONFUSABLES).join('')}]`, 'gu')

export function foldConfusables(s: string): string {
  return s.replace(CONFUSABLE_RE, (c) => CONFUSABLES[c] ?? c)
}

/** NFKC, invisible and control characters removed, homoglyphs folded. */
export function normalizeUnicode(s: string): string {
  const out = s
    .normalize('NFKC')
    .replace(ANSI_RE, '')
    .replace(INVISIBLE_RE, '')
    .replace(CONTROL_RE, '')
  return foldConfusables(out)
}

/** `normalizeUnicode` plus undoing empty-quote splitting. Safe for any text. */
export function normalize(s: string): string {
  // Empty quote pairs inside a word (`c''url`, `c""url`) are a classic way to split a command name.
  return normalizeUnicode(s).replace(/(\w)(?:''|"")+(?=\w)/g, '$1')
}

/** Extra undoing of shell-only tricks: `c\url`, `${IFS}`, ANSI-C `$'\x63url'`. */
export function normalizeShell(s: string): string {
  let out = s.replace(/\$\{IFS(?:%\?\?)?\}|\$IFS\b/g, ' ')
  out = out.replace(/\$'((?:[^'\\]|\\.)*)'/g, (_, body: string) => decodeEscapes(body))
  out = out.replace(/(?<=[A-Za-z])\\(?=[A-Za-z])/g, '')
  return out
}

/** Decodes `\xNN`, `\uNNNN`, `\NNN` (octal) and the usual single-character escapes. */
export function decodeEscapes(s: string): string {
  return s.replace(/\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|[0-7]{1,3}|.)/g, (_, e: string): string => {
    if (e[0] === 'x' || e[0] === 'u') return String.fromCharCode(Number.parseInt(e.slice(1), 16))
    if (/^[0-7]+$/.test(e)) return String.fromCharCode(Number.parseInt(e, 8))
    return { n: '\n', t: '\t', r: '\r', '0': '\0' }[e] ?? e
  })
}

/* ------------------------------------------------------------------------------------------------
 * Snippets: what we echo back into a terminal, a JSON file or a GitHub annotation. Never raw.
 * ---------------------------------------------------------------------------------------------- */

/** Makes control and invisible characters visible, collapses whitespace and truncates. */
export function sanitize(s: string, max = 160): string {
  let out = ''
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0
    if (ch === '\t') out += ' '
    else if (cp < 0x20 || cp === 0x7f || (cp >= 0x80 && cp < 0xa0)) out += `\\x${hex(cp, 2)}`
    else if (INVISIBLE_ONE.test(ch)) out += `\\u{${hex(cp, 4)}}`
    else out += ch
    if (out.length > max * 2) break
  }
  out = out.replace(/\s+/g, ' ').trim()
  return out.length > max ? `${out.slice(0, max - 1)}…` : out
}

function hex(n: number, width: number): string {
  return n.toString(16).toUpperCase().padStart(width, '0')
}

/* ------------------------------------------------------------------------------------------------
 * Decoding candidates: encoded blobs whose decoded text is scanned with the same rules.
 * ---------------------------------------------------------------------------------------------- */

export interface Decoded {
  encoding: 'base64' | 'hex' | 'char-codes' | 'escapes' | 'gzip+base64' | 'zlib+base64'
  text: string
}

const MAX_DECODED = 64 * 1024
const BASE64_RE = /[A-Za-z0-9+/]{32,}={0,2}|[A-Za-z0-9_-]{32,}={0,2}/g
const HEX_RE = /\b(?:[0-9a-fA-F]{2}){16,}\b/g
const ESCAPES_RE = /(?:\\x[0-9a-fA-F]{2}|\\u00[0-9a-fA-F]{2}|\\[0-7]{3}){6,}/g
const CHAR_CODES_RE =
  /(?:fromCharCode|chr|bytes|bytearray|\[char\[\]\])\s*\(?\s*\[?\s*((?:\d{2,3}\s*[,+)]\s*(?:chr\s*\(\s*)?){5,}\d{0,3})/g

/** Printable-text check: decoded binary (images, hashes, keys) is not a payload. */
export function printable(s: string): boolean {
  if (s.length < 8) return false
  let ok = 0
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0
    if ((cp >= 0x20 && cp < 0x7f) || ch === '\n' || ch === '\r' || ch === '\t') ok++
  }
  return ok / s.length >= 0.9
}

function utf8(buf: Buffer): string {
  return buf.subarray(0, MAX_DECODED).toString('utf8')
}

function decompress(buf: Buffer): string | undefined {
  try {
    if (buf[0] === 0x1f && buf[1] === 0x8b)
      return utf8(gunzipSync(buf, { maxOutputLength: MAX_DECODED }))
    if (buf[0] === 0x78) return utf8(inflateSync(buf, { maxOutputLength: MAX_DECODED }))
  } catch {
    return undefined
  }
  return undefined
}

/** Every blob in `s` that decodes to readable text. */
export function decodeCandidates(s: string): Decoded[] {
  const out: Decoded[] = []
  for (const m of s.matchAll(BASE64_RE)) {
    const raw = m[0]
    // Long identifiers and paths are base64-alphabet too; the printable check filters them out.
    const buf = Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
    const inflated = decompress(buf)
    if (inflated !== undefined && printable(inflated)) {
      out.push({ encoding: buf[0] === 0x1f ? 'gzip+base64' : 'zlib+base64', text: inflated })
      continue
    }
    const text = utf8(buf)
    if (printable(text)) out.push({ encoding: 'base64', text })
  }
  for (const m of s.matchAll(HEX_RE)) {
    const text = utf8(Buffer.from(m[0], 'hex'))
    if (printable(text)) out.push({ encoding: 'hex', text })
  }
  for (const m of s.matchAll(ESCAPES_RE)) {
    const text = decodeEscapes(m[0])
    if (printable(text)) out.push({ encoding: 'escapes', text })
  }
  for (const m of s.matchAll(CHAR_CODES_RE)) {
    const codes = (m[1] ?? '').match(/\d{2,3}/g) ?? []
    const text = String.fromCharCode(...codes.map(Number).filter((c) => c < 0x110000))
    if (printable(text)) out.push({ encoding: 'char-codes', text })
  }
  return out
}

/* ------------------------------------------------------------------------------------------------
 * URLs and hosts.
 * ---------------------------------------------------------------------------------------------- */

export const URL_RE = /\b(?:https?|wss?|ftp):\/\/[^\s'"`<>()[\]{}\\|]+/gi

/** Host of a URL, lowercased, without credentials or port. Undefined for templated hosts. */
export function hostOf(url: string): string | undefined {
  const m = /^[a-z]+:\/\/(?:[^@/]*@)?(\[[^\]]+\]|[^/:?#]+)/i.exec(url)
  const host = m?.[1]?.toLowerCase().replace(/\.$/, '')
  if (!host || !/^(?:[a-z0-9-]+\.)*[a-z0-9-]+$|^\[[0-9a-f:]+\]$/.test(host)) return undefined
  return host
}

export function isIPv4(host: string): boolean {
  return /^(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(host)
}

/** Loopback, private, link-local, CGNAT and unspecified ranges. Documentation ranges count as public. */
export function isPrivateIPv4(host: string): boolean {
  const [a = 0, b = 0] = host.split('.').map(Number)
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127)
  )
}

/** Hosts that only ever appear as placeholders: RFC 2606/6761 names and loopback. */
export function isPlaceholderHost(host: string): boolean {
  return (
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host === '[::1]' ||
    /^127\./.test(host) ||
    /(?:^|\.)(?:example\.(?:com|net|org)|example|invalid|test|localhost|local)$/.test(host)
  )
}
