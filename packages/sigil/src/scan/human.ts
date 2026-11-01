import pc from 'picocolors'
import type { Severity } from '../core/index.js'
import { TOOL_STAMP } from './scan.js'
import { sanitize } from './text.js'
import type { ScanFinding, ScanReport } from './types.js'

const COLOR: Record<Severity, (s: string) => string> = {
  critical: (s) => pc.bold(pc.red(s)),
  high: pc.red,
  medium: pc.yellow,
  low: pc.dim,
  info: pc.dim,
}
const MARK: Record<ScanReport['units'][number]['status'], string> = {
  pass: pc.green('✓'),
  warn: pc.yellow('!'),
  fail: pc.red('✗'),
}

/** Human output grouped by unit, with a per-unit header and a final summary line. */
export function formatHuman(report: ScanReport, opts: { color?: boolean } = {}): string {
  if (!opts.color) (pc as { enabled?: boolean }).enabled = false
  const out: string[] = []
  const totals: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 }

  for (const unit of report.units) {
    const visible = unit.findings
    for (const f of visible) totals[f.suppressed ? 'info' : f.severity]++
    const label = `${MARK[unit.status]} ${pc.bold(unit.name)} ${pc.dim(`(${unit.kind}, ${unit.files} file${unit.files === 1 ? '' : 's'})`)}`
    out.push(label)
    if (visible.length === 0) {
      out.push(`    ${pc.dim('no findings')}`)
    }
    for (const f of visible) out.push(...formatFinding(f))
    out.push('')
  }

  const parts = (['critical', 'high', 'medium', 'low', 'info'] as const)
    .filter((s) => totals[s] > 0)
    .map((s) => COLOR[s](`${totals[s]} ${s}`))
  const unitCounts = `${report.units.length} unit${report.units.length === 1 ? '' : 's'}`
  const failing = report.units.filter((u) => u.status === 'fail').length
  out.push(
    `${pc.dim(TOOL_STAMP)}  ${unitCounts}  ${parts.length ? parts.join(pc.dim(', ')) : pc.green('clean')}${failing ? pc.red(`  ${failing} failing`) : ''}`,
  )
  return out.join('\n')
}

function formatFinding(f: ScanFinding): string[] {
  const sev = f.suppressed ? 'info' : f.severity
  const owasp = f.owasp ? pc.dim(` ${f.owasp}`) : ''
  const where = f.file ? pc.cyan(`${f.file}${f.line ? `:${f.line}` : ''}`) : ''
  const head = `    ${COLOR[sev](sev.padEnd(8))} ${pc.dim(f.rule)}${owasp} ${where}`
  const lines = [head, `      ${f.message}`]
  if (f.snippet) {
    const s = sanitize(f.snippet, 100)
    if (s) lines.push(`      ${pc.dim('│')} ${pc.dim(s)}`)
  }
  return lines
}
