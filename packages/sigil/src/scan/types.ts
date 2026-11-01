import type { Finding, Manifest, Severity } from '../core/index.js'

/**
 * Where a match sits decides how much it matters. The same `curl … | bash` is a live risk in a script
 * or in an instruction the agent will follow, and a teaching aid inside a "what attacks look like" section.
 *
 * - `script`: code the agent harness or the agent will execute (scripts, hook and MCP commands,
 *   `!`cmd`` preprocessing, package lifecycle scripts).
 * - `instruction`: text the agent reads as instructions (SKILL.md, rules, commands, agent definitions,
 *   frontmatter descriptions), including code blocks it is told to run.
 * - `example`: code or prose inside an educational or negative context (a security section, a "Bad:"
 *   example, "never run …", a list of patterns to detect).
 * - `reference`: supporting material the agent reads only on demand, and comments in code.
 */
export const LOCATION_KINDS = ['script', 'instruction', 'example', 'reference'] as const
export type LocationKind = (typeof LOCATION_KINDS)[number]

export type Family =
  | 'remote-code'
  | 'obfuscation'
  | 'unicode'
  | 'injection'
  | 'credentials'
  | 'exfiltration'
  | 'persistence'
  | 'destructive'
  | 'bundled'
  | 'conformance'
  | 'meta'

/** What a file is to the agent. Decides the default location kind of its lines. */
export type FileRole = 'entry' | 'doc' | 'script' | 'config' | 'data'

/** One logical line of a text file, classified. Continuation lines are joined onto the first. */
export interface Line {
  /** 1-based line number in the file. */
  n: number
  /** Original text (continuations joined). Used for snippets, suppression and Unicode rules. */
  raw: string
  /** Normalised text for matching: NFKC, invisible characters removed, homoglyphs folded, shell quoting tricks undone. */
  text: string
  kind: LocationKind
  /** Inside an HTML comment or hidden markup: visible to the agent, hidden from a human reading rendered markdown. */
  concealed: boolean
  /** Shell-like content (shell scripts, shell code blocks, hook commands), where shell parsing applies. */
  shell: boolean
  /** Inside a fenced code block, or a code line of a script. */
  code: boolean
  /** Heading trail for markdown, e.g. "Setup > Prerequisites". */
  section: string
  /** Synthesised from structure rather than a literal line: a hook, MCP or package script command, or `!`cmd``. */
  virtual?: 'hook' | 'mcp' | 'package-script' | 'helper' | 'preprocess'
}

export interface ScannedFile {
  /** POSIX path relative to the unit directory. Archive members look like `docs.zip!/word/x.sh`. */
  path: string
  role: FileRole
  /** Full decoded text. */
  text: string
  lines: Line[]
  bytes: number
  /** Shell, python, js, powershell, … for script files. */
  language?: string
}

export interface Hit {
  /** Reports under another rule id (a rule that fired inside a decoded payload). */
  rule?: string
  file?: string
  line?: number
  message: string
  severity: Severity
  kind?: LocationKind
  snippet?: string
}

export interface RuleMeta {
  /** `SIG-SEC-NNN`. Stable forever: ids are never reused. */
  id: string
  /** Kebab-case name, e.g. `pipe-to-shell`. */
  name: string
  family: Family
  /** One line, shown in the CLI and as the SARIF short description. */
  title: string
  /** OWASP Agentic Skills Top 10 id, e.g. `AST01`. */
  owasp?: string
  /** Markdown: what it catches, why it matters, how to fix it. Used for SARIF help. */
  help: string
  /** Known false positives, so reviewers know when a finding is likely benign. */
  falsePositives: string
  /** Hidden-Unicode rules cannot be suppressed: there is no legitimate reason to hide text from reviewers. */
  suppressible: boolean
  /** Severity in the most dangerous context. Used for SARIF defaults. */
  severity: Severity
}

/** Facts gathered while scanning, for manifest conformance. */
export interface Facts {
  hosts: Map<string, Use>
  commands: Map<string, Use>
  env: Map<string, Use>
  writes: Use[]
  /** `allowed-tools` from SKILL.md frontmatter, if any. */
  allowedTools: { tools: string[]; use: Use }[]
}

export interface Use {
  file: string
  line: number
  kind: LocationKind
  count: number
}

export type UnitKind = 'capability' | 'skill' | 'plugin' | 'config' | 'directory' | 'file'

export interface Unit {
  kind: UnitKind
  /** Display name: manifest id, SKILL.md name, plugin name or directory name. */
  name: string
  /** Absolute directory the unit's paths are relative to. */
  dir: string
  /** Absolute paths of the files in the unit, when the unit is not "everything under dir". */
  files?: string[]
  /** Absolute directories excluded from a whole-directory unit (nested units). */
  exclude: string[]
  /** Files whose markdown is the agent's entry point (POSIX, relative to dir). */
  entries: string[]
  manifest?: Manifest
  /** Set when sigil.yaml exists but does not parse: conformance is skipped, and we say so. */
  manifestError?: string
}

export interface ScanFinding extends Finding {
  /** Location kind the severity was decided for. */
  kind?: LocationKind
  /** The offending text, sanitised (control and invisible characters made visible) and truncated. */
  snippet?: string
  /** Present when an inline `sigil-scan-ignore` suppressed the finding. Severity is then `info`. */
  suppressed?: { reason: string; severity: Severity }
}

export interface UnitReport {
  kind: UnitKind
  name: string
  /** Unit directory relative to the scan root (POSIX), `.` for the root itself. */
  path: string
  files: number
  status: 'pass' | 'warn' | 'fail'
  findings: ScanFinding[]
}

export interface ScanReport {
  /** Absolute scan root. */
  root: string
  tool: { name: string; version: string }
  at: string
  units: UnitReport[]
}

export interface ScanOptions {
  /** Manifest to check conformance against, overriding sigil.yaml in the directory. */
  manifest?: Manifest
  /** Clock for reproducible output. */
  now?: Date
}
