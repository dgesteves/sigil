import { lstat, readFile, readlink, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { Severity } from '../core/index.js'
import { readZip } from './archive.js'
import { collectFacts, emptyFacts } from './facts.js'
import { classify, decodeText, sniff } from './filetype.js'
import { FILE_RULES, LINE_RULES, RULE_META, UNIT_RULES } from './rules/index.js'
import type { FileContext, LineRule, Rule, UnitContext, UnitEntry } from './rules/rule.js'
import { mentioned, negated } from './rules/rule.js'
import { segment } from './segment.js'
import { parseConfig } from './structured.js'
import { parseSuppressions, type Suppression } from './suppress.js'
import { normalize, normalizeShell } from './text.js'
import type { Facts, Line, ScanFinding, ScannedFile, Unit, UnitReport } from './types.js'

const MAX_READ_BYTES = 8 * 1024 * 1024
const posixify = (p: string) => p.split(sep).join('/')

/** Scans one unit and returns its report. Reads files; never executes anything. */
export async function scanUnit(unit: Unit): Promise<UnitReport> {
  const files = unit.files ?? (await enumerate(unit))
  const contexts: FileContext[] = []
  const entries: UnitEntry[] = []
  const facts = emptyFacts()
  const findings: ScanFinding[] = []
  const inner = makeInner()

  for (const abs of files) {
    const rel = posixify(relative(unit.dir, abs))
    let info: Awaited<ReturnType<typeof lstat>>
    try {
      info = await lstat(abs)
    } catch {
      continue
    }
    if (info.isSymbolicLink()) {
      const target = await readlink(abs).catch(() => '?')
      const escapes = await symlinkEscapes(abs, unit.dir)
      entries.push({ type: 'symlink', path: rel, target, escapes })
      continue
    }
    if (!info.isFile()) continue
    if (info.size > MAX_READ_BYTES) {
      entries.push({
        type: 'unscannable',
        path: rel,
        reason: `file is ${info.size} bytes (over ${MAX_READ_BYTES})`,
      })
      continue
    }
    const buf = await readFile(abs)
    await ingest(rel, buf, unit, contexts, entries, facts, inner)
  }

  // Line and file rules
  for (const ctx of contexts) {
    for (const rule of LINE_RULES) findings.push(...runLineRule(rule, ctx))
    for (const rule of FILE_RULES) {
      for (const hit of rule.check(ctx)) {
        findings.push(
          finding(
            hit.rule ?? rule.id,
            hit.severity,
            hit.message,
            ctx.file.path,
            hit.line,
            hit.kind,
            hit.snippet,
          ),
        )
      }
    }
    for (const inv of parseSuppressions(ctx.file.text).invalid) {
      findings.push(finding('SIG-SEC-900', 'low', inv.message, ctx.file.path, inv.line))
    }
  }

  // Unit rules
  const unitCtx: UnitContext = {
    unit,
    files: contexts,
    facts,
    entries,
    ...(unit.manifest ? { manifest: unit.manifest } : {}),
  }
  for (const rule of UNIT_RULES) {
    for (const hit of rule.check(unitCtx)) {
      findings.push(
        finding(
          hit.rule ?? rule.id,
          hit.severity,
          hit.message,
          hit.file,
          hit.line,
          hit.kind,
          hit.snippet,
        ),
      )
    }
  }

  // Suppressions: collected per file, applied across every finding on that file.
  applySuppressions(findings, contexts)

  const path = unit.files ? '.' : posixify(relative(unit.dir, unit.dir)) || '.'
  return {
    kind: unit.kind,
    name: unit.name,
    path: unit.manifestError ? '.' : path,
    files: contexts.length,
    status: statusOf(findings),
    findings: sortFindings(findings),
  }
}

/* ------------------------------------------------------------------------------------------------
 * Reading one file into contexts/entries
 * ---------------------------------------------------------------------------------------------- */

async function ingest(
  rel: string,
  buf: Buffer,
  unit: Unit,
  contexts: FileContext[],
  entries: UnitEntry[],
  facts: Facts,
  inner: FileContext['inner'],
): Promise<void> {
  const kind = sniff(buf, rel)
  if (kind.type === 'archive') {
    recordArchive(rel, buf, kind, entries)
    if (!kind.office) return
  }
  if (kind.type === 'executable') {
    entries.push({
      type: 'binary',
      path: rel,
      format: kind.format,
      class: 'executable',
      bytes: buf.length,
    })
    return
  }
  if (kind.type === 'bytecode') {
    entries.push({
      type: 'binary',
      path: rel,
      format: kind.format,
      class: 'bytecode',
      bytes: buf.length,
    })
    return
  }
  if (kind.type === 'media') {
    entries.push({
      type: 'binary',
      path: rel,
      format: kind.format,
      class: 'media',
      bytes: buf.length,
    })
    return
  }
  if (kind.type === 'binary') {
    entries.push({
      type: 'unscannable',
      path: rel,
      reason: 'binary file (not recognised and not text)',
    })
    return
  }
  if (kind.type === 'archive' && kind.office) {
    entries.push({
      type: 'binary',
      path: rel,
      format: kind.format,
      class: 'archive',
      office: true,
      bytes: buf.length,
    })
    return
  }

  // Text: a file claiming text whose bytes say otherwise is disguised.
  if (
    /\.(?:txt|md|json|ya?ml|toml)$/i.test(rel) &&
    buf.subarray(0, 4).includes(0x50) &&
    buf[0] === 0x50 &&
    buf[1] === 0x4b
  ) {
    entries.push({ type: 'disguised', path: rel, format: 'ZIP' })
  }
  const text = decodeText(buf)
  contexts.push(buildContext(rel, text, buf, unit, inner))
  collectFacts(contexts.at(-1)!.file.lines, rel, facts)
}

function recordArchive(
  rel: string,
  buf: Buffer,
  kind: ReturnType<typeof sniff> & { type: 'archive' },
  entries: UnitEntry[],
): void {
  if (kind.format !== 'ZIP' && !/JAR|WAR|APK|WHL|EGG/.test(kind.format)) {
    entries.push({
      type: 'binary',
      path: rel,
      format: kind.format,
      class: 'archive',
      ...(kind.office ? { office: true } : {}),
      bytes: buf.length,
    })
    return
  }
  const zip = readZip(buf)
  if (zip.incomplete)
    entries.push({ type: 'archive-incomplete', archive: rel, reason: zip.incomplete })
  let scripty = false
  for (const m of zip.members) {
    const executable =
      /\.(?:sh|bash|zsh|py|js|mjs|cjs|rb|pl|php|ps1|bat|cmd|command|exe|dll|so|dylib|bin|run|scpt|vbs)$/i.test(
        m.name,
      ) ||
      (m.name.endsWith('/') === false && /(?:^|\/)(?:bin|scripts?)\//.test(m.name))
    if (m.encrypted || executable) {
      entries.push({
        type: 'archive-member',
        archive: rel,
        member: m.name,
        encrypted: m.encrypted,
        executable,
      })
      scripty = true
    }
  }
  if (!kind.office && !scripty && zip.members.length)
    entries.push({
      type: 'binary',
      path: rel,
      format: kind.format,
      class: 'archive',
      bytes: buf.length,
    })
}

function buildContext(
  rel: string,
  text: string,
  buf: Buffer,
  unit: Unit,
  inner: FileContext['inner'],
): FileContext {
  const entrySet = new Set(unit.entries)
  const { role, language } = classify(rel, text, entrySet)
  const seg = segment(rel, text, role, language)
  const file: ScannedFile = {
    path: rel,
    role,
    text,
    lines: seg.lines,
    bytes: buf.length,
    ...(language ? { language } : {}),
  }
  const config = role === 'config' ? parseConfig(rel, text) : undefined
  if (config) file.lines.push(...virtualConfigLines(config))
  const ctx: FileContext = {
    file,
    comments: seg.comments,
    ...(config ? { config } : {}),
    buffer: buf,
    inner,
  }
  const fm = seg.frontmatterEnd > 0 ? parseFrontmatterData(text) : undefined
  if (fm) ctx.frontmatter = fm
  return ctx
}

function virtualConfigLines(config: NonNullable<ReturnType<typeof parseConfig>>): Line[] {
  return config.extracted.map((e) => ({
    n: e.line,
    raw: e.command,
    text: normalizeShell(normalize(e.command)),
    kind: 'script' as const,
    concealed: false,
    shell: true,
    code: true,
    section: e.key ?? '',
    virtual: e.kind === 'package-script' ? ('package-script' as const) : e.kind,
  }))
}

function parseFrontmatterData(text: string): Record<string, unknown> | undefined {
  const m = /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)\r?\n/.exec(text)
  if (!m) return undefined
  const data: Record<string, unknown> = {}
  for (const line of (m[1] ?? '').split('\n')) {
    const kv = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line)
    if (kv) data[kv[1]!] = kv[2]
  }
  return data
}

/* ------------------------------------------------------------------------------------------------
 * Running line rules
 * ---------------------------------------------------------------------------------------------- */

function runLineRule(rule: LineRule, ctx: FileContext): ScanFinding[] {
  const out: ScanFinding[] = []
  for (const line of ctx.file.lines) {
    const sev = rule.table[line.kind]
    if (!sev && !line.concealed) continue
    for (const m of rule.match(line, ctx)) {
      if (rule.negationAware && negated(line.text, m.index)) continue
      let severity: Severity | null = m.severity ?? resolveSeverity(rule, line, sev)
      if (rule.mentionAware && mentioned(line.text, m.index)) {
        severity = rule.table.example
        if (!severity) continue
      }
      if (!severity) continue
      if (m.bump) severity = bump(severity, m.bump)
      // Hidden-channel text is always worth at least a warning even where the table says skip.
      if (line.concealed && (severity === 'info' || !sev)) severity = bump(severity, 1)
      out.push(
        finding(
          rule.id,
          severity,
          m.message ?? rule.message,
          ctx.file.path,
          line.n,
          line.kind,
          snippetOf(line),
        ),
      )
    }
  }
  return out
}

function resolveSeverity(rule: LineRule, line: Line, base: Severity | null): Severity | null {
  // A concealed instruction is as dangerous as a script instruction.
  if (line.concealed && (line.kind === 'instruction' || line.kind === 'reference'))
    return rule.table.script ?? base
  return base
}

const ORDER: readonly Severity[] = ['info', 'low', 'medium', 'high', 'critical']
function bump(s: Severity, by: number): Severity {
  return ORDER[Math.max(0, Math.min(ORDER.length - 1, ORDER.indexOf(s) + by))]!
}

function snippetOf(line: Line): string {
  return line.raw.length > 200 ? line.raw : line.raw
}

/* ------------------------------------------------------------------------------------------------
 * Suppressions, status, ordering
 * ---------------------------------------------------------------------------------------------- */

function applySuppressions(findings: ScanFinding[], contexts: FileContext[]): void {
  const byFile = new Map<string, Suppression[]>()
  for (const ctx of contexts)
    byFile.set(ctx.file.path, parseSuppressions(ctx.file.text).suppressions)
  for (const f of findings) {
    if (!f.file || !f.line) continue
    const rule = RULE_META.get(f.rule)
    if (rule && rule.suppressible === false) continue
    const sup = (byFile.get(f.file) ?? []).find(
      (s) => s.target === f.line && (s.rules.includes(f.rule) || s.rules.includes('*')),
    )
    if (!sup) continue
    f.suppressed = { reason: sup.reason, severity: f.severity }
    f.severity = 'info'
    f.message = `${f.message} [suppressed: ${sup.reason}]`
  }
}

function statusOf(findings: readonly ScanFinding[]): 'pass' | 'warn' | 'fail' {
  let warn = false
  for (const f of findings) {
    if (f.severity === 'high' || f.severity === 'critical') return 'fail'
    if (f.severity === 'medium' || f.severity === 'low') warn = true
  }
  return warn ? 'warn' : 'pass'
}

function sortFindings(findings: ScanFinding[]): ScanFinding[] {
  const dedup = new Map<string, ScanFinding>()
  for (const f of findings) {
    const key = `${f.rule}|${f.file ?? ''}|${f.line ?? 0}|${f.message}`
    const prev = dedup.get(key)
    if (!prev || ORDER.indexOf(f.severity) > ORDER.indexOf(prev.severity)) dedup.set(key, f)
  }
  return [...dedup.values()].sort(
    (a, b) =>
      ORDER.indexOf(b.severity) - ORDER.indexOf(a.severity) ||
      (a.file ?? '').localeCompare(b.file ?? '') ||
      (a.line ?? 0) - (b.line ?? 0) ||
      a.rule.localeCompare(b.rule),
  )
}

function finding(
  rule: string,
  severity: Severity,
  message: string,
  file?: string,
  line?: number,
  kind?: Line['kind'],
  snippet?: string,
): ScanFinding {
  const meta = RULE_META.get(rule)
  return {
    rule,
    severity,
    message,
    ...(file ? { file } : {}),
    ...(line ? { line } : {}),
    ...(meta?.owasp ? { owasp: meta.owasp } : {}),
    ...(kind ? { kind } : {}),
    ...(snippet ? { snippet } : {}),
  }
}

/* ------------------------------------------------------------------------------------------------
 * The decoded-payload inner scanner (used by SIG-SEC-011)
 * ---------------------------------------------------------------------------------------------- */

function makeInner(): FileContext['inner'] {
  return (text: string) => {
    const line: Line = {
      n: 1,
      raw: text,
      text: normalizeShell(normalize(text)),
      kind: 'script',
      concealed: false,
      shell: true,
      code: true,
      section: '',
    }
    const fakeCtx = {
      file: { path: '', role: 'script', text, lines: [line], bytes: text.length },
      comments: [],
    } as unknown as FileContext
    const found: { rule: string; severity: Severity; message: string }[] = []
    for (const rule of LINE_RULES) {
      if (rule.id === 'SIG-SEC-011') continue
      const sev = rule.table.script
      if (!sev) continue
      for (const m of rule.match(line, fakeCtx)) {
        if (rule.negationAware && negated(line.text, m.index)) continue
        if (rule.mentionAware && mentioned(line.text, m.index)) continue
        found.push({
          rule: rule.id,
          severity: m.severity ?? (m.bump ? bump(sev, m.bump) : sev),
          message: m.message ?? rule.message,
        })
      }
    }
    return found
  }
}

/* ------------------------------------------------------------------------------------------------
 * File enumeration for whole-directory units
 * ---------------------------------------------------------------------------------------------- */

async function enumerate(unit: Unit): Promise<string[]> {
  const { readdir } = await import('node:fs/promises')
  const out: string[] = []
  const excluded = new Set(unit.exclude.map((d) => resolve(d)))
  const walk = async (dir: string): Promise<void> => {
    if (excluded.has(resolve(dir))) return
    let dirents: import('node:fs').Dirent[]
    try {
      dirents = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const d of dirents) {
      const abs = join(dir, d.name)
      if (excluded.has(resolve(abs))) continue
      if (d.isDirectory()) {
        if (d.name === 'node_modules' || d.name === '.git') continue
        await walk(abs)
      } else {
        out.push(abs)
      }
    }
  }
  await walk(unit.dir)
  return out.sort()
}

async function symlinkEscapes(linkPath: string, root: string): Promise<boolean> {
  try {
    const target = await realpath(linkPath)
    const base = await realpath(root)
    const rel = relative(base, target)
    return rel === '' ? false : rel.startsWith('..') || isAbsolute(rel)
  } catch {
    return true
  }
}

export type { Rule }
