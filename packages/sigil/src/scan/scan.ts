import { statSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'
import pkg from '../../package.json' with { type: 'json' }
import type { Check, Finding } from '../core/index.js'
import { discover } from './discover.js'
import { scanUnit } from './engine.js'
import type { ScanFinding, ScanOptions, ScanReport, UnitReport } from './types.js'

export const TOOL_NAME = 'sigil-scan'
export const TOOL_VERSION = pkg.version
export const TOOL_STAMP = `${TOOL_NAME}@${TOOL_VERSION}`

const posixify = (p: string) => p.split(sep).join('/')

/** Scans a directory and returns a single core `Check`. Works on any directory (see `discover`). */
export async function scan(dir: string, opts: ScanOptions = {}): Promise<Check> {
  const report = await scanReport([dir], process.cwd(), opts)
  return toCheck(report, opts.now)
}

/** Scans one or more paths and keeps the per-unit structure, for the CLI's human and SARIF output. */
export async function scanReport(
  paths: string[],
  cwd: string,
  opts: ScanOptions = {},
): Promise<ScanReport> {
  const root = resolve(cwd)
  const units: UnitReport[] = []
  for (const p of paths) {
    const abs = resolve(cwd, p)
    // Display paths relative to the scanned target, so a repo of skills reads as `skills/foo`.
    const base = isDirectory(abs) ? abs : dirname(abs)
    for (const unit of await discover(abs)) {
      if (opts.manifest && (unit.kind === 'capability' || unit.kind === 'skill'))
        unit.manifest = opts.manifest
      const report = await scanUnit(unit)
      const rel = posixify(relative(base, unit.dir))
      report.path = rel && !rel.startsWith('..') ? rel : posixify(relative(root, unit.dir)) || '.'
      units.push(prefixPaths(report))
    }
  }
  return {
    root,
    tool: { name: TOOL_NAME, version: TOOL_VERSION },
    at: (opts.now ?? new Date()).toISOString(),
    units,
  }
}

/** Rewrites each finding's file to be relative to the scan root, not the unit directory. */
function prefixPaths(report: UnitReport): UnitReport {
  if (report.path === '.') return report
  for (const f of report.findings) if (f.file) f.file = `${report.path}/${f.file}`
  return report
}

function isDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

/** Flattens a report into the core Check shape: worst status wins, findings are plain core Findings. */
export function toCheck(report: ScanReport, now?: Date): Check {
  const findings: Finding[] = []
  let status: Check['status'] = 'pass'
  for (const u of report.units) {
    if (u.status === 'fail') status = 'fail'
    else if (u.status === 'warn' && status !== 'fail') status = 'warn'
    for (const f of u.findings) findings.push(toFinding(f))
  }
  return { status, tool: report.tool, at: now ? now.toISOString() : report.at, findings }
}

/** Core Finding is a strict object: drop scan-only fields (kind, snippet, suppressed). */
export function toFinding(f: ScanFinding): Finding {
  return {
    rule: f.rule,
    severity: f.severity,
    message: f.message,
    ...(f.file ? { file: f.file } : {}),
    ...(f.line ? { line: f.line } : {}),
    ...(f.owasp ? { owasp: f.owasp } : {}),
  }
}

/** Highest severity present across a report, for exit codes. */
export function worstSeverity(report: ScanReport): Finding['severity'] | undefined {
  const order: Finding['severity'][] = ['info', 'low', 'medium', 'high', 'critical']
  let worst: Finding['severity'] | undefined
  for (const u of report.units)
    for (const f of u.findings)
      if (!worst || order.indexOf(f.severity) > order.indexOf(worst)) worst = f.severity
  return worst
}
