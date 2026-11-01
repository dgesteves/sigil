import type { Manifest, Severity } from '../../core/index.js'
import type { CommentBlock } from '../segment.js'
import type { StructuredConfig } from '../structured.js'
import type { Facts, Hit, Line, LocationKind, RuleMeta, ScannedFile, Unit } from '../types.js'

/** Severity per location kind. `null`: not worth reporting there. */
export type SeverityTable = Record<LocationKind, Severity | null>

export const table = (
  script: Severity | null,
  instruction: Severity | null,
  reference: Severity | null,
  example: Severity | null,
): SeverityTable => ({ script, instruction, reference, example })

export interface LineMatch {
  /** Index of the match in `line.text`, for negation and mention checks. */
  index: number
  /** Overrides the rule message. */
  message?: string
  /** Raises the table severity by this many levels (a raw IP target, a paste site, a decoded payload). */
  bump?: number
  /** Absolute severity, ignoring the table. */
  severity?: Severity
}

export interface FileContext {
  file: ScannedFile
  comments: CommentBlock[]
  frontmatter?: Record<string, unknown>
  config?: StructuredConfig
  /** Bytes for binary checks (not present for archive members). */
  buffer?: Buffer
  /** Scans decoded text with every line rule, as if it were a script. Set by the engine. */
  inner?: (text: string) => { rule: string; severity: Severity; message: string }[]
}

export interface LineRule extends RuleMeta {
  scope: 'line'
  table: SeverityTable
  message: string
  /** "Never run `rm -rf ~`" is advice, not an instruction. Off for rules whose pattern is itself a negation. */
  negationAware?: boolean
  /** "Detect phrases like 'ignore previous instructions'" mentions the phrase without using it. */
  mentionAware?: boolean
  match: (line: Line, ctx: FileContext) => LineMatch[]
}

export interface FileRule extends RuleMeta {
  scope: 'file'
  check: (ctx: FileContext) => Hit[]
}

export interface UnitContext {
  unit: Unit
  files: FileContext[]
  facts: Facts
  /** Non-text files, symlinks and files that could not be scanned. */
  entries: UnitEntry[]
  manifest?: Manifest
}

export type UnitEntry =
  | {
      type: 'binary'
      path: string
      format: string
      class: 'executable' | 'bytecode' | 'archive' | 'binary' | 'media'
      office?: boolean
      bytes: number
    }
  | { type: 'symlink'; path: string; target: string; escapes: boolean }
  | { type: 'unscannable'; path: string; reason: string }
  | { type: 'dir'; path: string; name: '.git' | 'node_modules'; files: number }
  | {
      type: 'archive-member'
      archive: string
      member: string
      encrypted: boolean
      executable: boolean
    }
  | { type: 'archive-incomplete'; archive: string; reason: string }
  | { type: 'disguised'; path: string; format: string }

export interface UnitRule extends RuleMeta {
  scope: 'unit'
  check: (ctx: UnitContext) => Hit[]
}

export type Rule = LineRule | FileRule | UnitRule

/* ------------------------------------------------------------------------------------------------
 * Matching helpers
 * ---------------------------------------------------------------------------------------------- */

/** All matches of `re` in `s`, as LineMatch. The regex is cloned with the g flag. */
export function all(re: RegExp, s: string, extra: Omit<LineMatch, 'index'> = {}): LineMatch[] {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`)
  return [...s.matchAll(g)].map((m) => ({ index: m.index ?? 0, ...extra }))
}

/** First match of any pattern. */
export function first(
  patterns: readonly RegExp[],
  s: string,
  extra: Omit<LineMatch, 'index'> = {},
): LineMatch[] {
  for (const re of patterns) {
    const m = re.exec(s)
    if (m) return [{ index: m.index, ...extra }]
  }
  return []
}

const NEGATION_BEFORE =
  /(?:\b(?:never|don'?t|do not|does not|must not|mustn'?t|should not|shouldn'?t|cannot|can'?t|won'?t|avoid(?:ing)?|refuse|forbid(?:den)?|prohibit(?:ed)?|not allowed|disallow(?:ed)?|block(?:s|ed|ing)?|reject(?:s|ed)?|den(?:y|ies|ied)|warn(?:s|ing)? (?:about|against)|beware(?: of)?|instead of|rather than|unsafe|dangerous|malicious|insecure|stop)\b|❌|✗|✘|🚫|⛔)/i
const NEGATION_AFTER =
  /^.{0,60}?\b(?:is|are|was|looks?|counts? as)\s+(?:a\s+|an\s+)?(?:dangerous|unsafe|risky|malicious|forbidden|blocked|not allowed|red flag|bad|insecure|suspicious|never)\b/i

/** True when the text before the match (same line, up to 100 chars) or right after it negates it. */
export function negated(text: string, index: number): boolean {
  const before = text.slice(Math.max(0, index - 100), index)
  return NEGATION_BEFORE.test(before) || NEGATION_AFTER.test(text.slice(index))
}

const MENTION =
  /\b(?:such as|like|e\.g\.|for example|for instance|phrases?|patterns?|strings?|detect(?:s|ed|ion|ing)?|flag(?:s|ged)?|catch(?:es)?|scan(?:s|ner|ners)?|signatures?|indicators?|watch (?:out )?for|look(?:s|ing)? for|attempts? (?:to|like)|known as|called|keywords?|regex(?:es)?|match(?:es|ing)?|injections?|jailbreaks?|attacks?|attackers?|malicious)\b/i

/** True when the line talks about the phrase (detection, examples, quotes) rather than using it. */
export function mentioned(text: string, index: number): boolean {
  if (MENTION.test(text)) return true
  const before = text.slice(Math.max(0, index - 3), index)
  return /["'“‘`]\s*$/.test(before)
}

/** Paste and snippet hosts used to deliver second-stage commands (ClawHavoc, Snyk's "google" skill). */
export const PASTE_HOSTS =
  /\b(?:rentry\.(?:co|org)|glot\.io|pastebin\.com|paste\.ee|hastebin\.(?:com|skyra\.pw)|ghostbin\.\w+|justpaste\.it|controlc\.com|pastes\.io|dpaste\.(?:org|com)|paste\.rs|termbin\.com|sprunge\.us|ix\.io|paste\.c-net\.org|privatebin\.\w+|telegra\.ph|codeshare\.io|pastecode\.io|paste2\.org|gist\.githubusercontent\.com)\b/i

/** Collection, tunnel and out-of-band endpoints used to receive stolen data. */
export const EXFIL_HOSTS =
  /\b(?:webhook\.site|(?:[\w-]+\.)*requestbin\.(?:com|net)|requestcatcher\.com|(?:[\w-]+\.)*pipedream\.net|hookbin\.com|beeceptor\.com|(?:[\w-]+\.)*ngrok(?:-free)?\.(?:io|app|dev)|(?:[\w-]+\.)*trycloudflare\.com|(?:[\w-]+\.)*loca\.lt|serveo\.net|(?:[\w-]+\.)*interact\.sh|(?:[\w-]+\.)*oast\.(?:pro|live|site|online|fun|me)|(?:[\w-]+\.)*burpcollaborator\.net|(?:[\w-]+\.)*oastify\.com|canarytokens\.com|(?:[\w-]+\.)*dnslog\.cn|(?:[\w-]+\.)*ceye\.io|transfer\.sh|0x0\.st|file\.io|temp\.sh|bashupload\.com|termbin\.com|paste\.c-net\.org)\b/i

/** Chat-bot endpoints: legitimate for notifications, also the favourite exfiltration channel. */
export const CHAT_WEBHOOKS =
  /\b(?:discord(?:app)?\.com\/api\/webhooks\/|api\.telegram\.org\/bot|hooks\.slack\.com\/services\/)/i

/** Secret stores outside the project: private keys, cloud and CLI credentials, keychains, browsers, wallets. */
export const SECRET_PATHS: readonly { re: RegExp; what: string }[] = [
  {
    re: /\.ssh\/(?:id_(?:rsa|dsa|ecdsa|ed25519)(?:_sk)?|identity)\b(?!\.pub)/i,
    what: 'SSH private key',
  },
  {
    re: /(?:~|\$\{?HOME\}?|%USERPROFILE%|\/Users\/[\w.-]+|\/home\/[\w.-]+|\/root)\/\.ssh(?:\/\*|\/?(?=[\s'"`)]|$))/i,
    what: 'SSH directory',
  },
  {
    re: /\.aws\/(?:credentials|config)\b|\bAWS_SECRET_ACCESS_KEY\b(?=\s*[)}"'`]|\s*$)/i,
    what: 'AWS credentials',
  },
  { re: /\.config\/gh\/hosts\.ya?ml|\.config\/gh\b(?=[\s/'"`]|$)/i, what: 'GitHub CLI token' },
  {
    re: /(?:~|\$\{?HOME\}?)\/\.(?:netrc|git-credentials|npmrc|pypirc|docker\/config\.json|kube\/config|gnupg\b|password-store\b)/i,
    what: 'credential file',
  },
  {
    re: /\.config\/(?:gcloud|op|1password)\b|\.azure\/(?:accessTokens|msal_token_cache)|application_default_credentials\.json/i,
    what: 'cloud CLI credentials',
  },
  {
    re: /\.(?:clawdbot|openclaw|moltbot)\/(?:\.env|credentials|config)|\.claude\/\.credentials\.json|\.codex\/auth\.json|\.gemini\/oauth_creds\.json/i,
    what: 'agent credentials',
  },
  { re: /\/etc\/(?:shadow|gshadow|master\.passwd)\b/i, what: 'system password hashes' },
  {
    re: /\bsecurity\s+(?:find-(?:generic|internet)-password|dump-keychain|export\s+-k)\b|login\.keychain(?:-db)?\b|\bsecret-tool\s+lookup\b|\bcmdkey\s+\/list\b|\bvaultcmd\b|\bGet-StoredCredential\b/i,
    what: 'OS keychain',
  },
  {
    re: /(?:Google\/Chrome|Chromium|BraveSoftware|Microsoft\/Edge|Vivaldi|Opera Software|\.mozilla\/firefox|Firefox\/Profiles)\b[^\n]{0,80}?(?:Login Data|Cookies|Local State|Web Data|key4\.db|logins\.json|cookies\.sqlite)|\b(?:Login Data|key4\.db|logins\.json|cookies\.sqlite|Cookies\.binarycookies)\b/i,
    what: 'browser credential store',
  },
  {
    re: /\bwallet\.dat\b|\.(?:bitcoin|ethereum|electrum|solana|monero)\/(?:wallets?|keystore|id\.json)|\b(?:Exodus|Electrum|Phantom|MetaMask|Atomic Wallet|Ledger Live)\b[^\n]{0,60}?(?:wallet|seed|keystore|Local Extension Settings)|nkbihfbeogaeaoehlefnkodbefgpgknn/i,
    what: 'crypto wallet',
  },
]

export function secretPath(text: string): { index: number; what: string } | undefined {
  for (const { re, what } of SECRET_PATHS) {
    const m = re.exec(text)
    if (m) return { index: m.index, what }
  }
  return undefined
}

/** Shell output redirection or a file-writing call, i.e. "this line writes somewhere". */
export const WRITE_OP =
  /(?:>>?|\btee\s+(?:-a\s+)?|\bsed\s+-i\S*\s|\bcp\s+(?:-\w+\s+)*\S+\s+|\bmv\s+\S+\s+|\bln\s+-\w*s\w*\s+\S+\s+|\binstall\s+-\w+|\bwrite(?:File|FileSync|_text|_bytes)?\s*\(|\bappendFile(?:Sync)?\s*\(|\bopen\s*\([^)]*,\s*['"][wa]|\b(?:Add|Set)-Content\b|\bOut-File\b|\bdefaults\s+write\b|\bplutil\b)/

export const isWriteTo = (text: string, target: RegExp): boolean => {
  const t = target.exec(text)
  if (!t) return false
  const w = WRITE_OP.exec(text)
  return Boolean(w && w.index <= t.index + t[0].length)
}

export const SEVERITY_ORDER: readonly Severity[] = ['info', 'low', 'medium', 'high', 'critical']

export function bumpSeverity(s: Severity, by: number): Severity {
  const i = SEVERITY_ORDER.indexOf(s)
  return SEVERITY_ORDER[Math.max(0, Math.min(SEVERITY_ORDER.length - 1, i + by))]!
}

export function atLeast(s: Severity, min: Severity): boolean {
  return SEVERITY_ORDER.indexOf(s) >= SEVERITY_ORDER.indexOf(min)
}
