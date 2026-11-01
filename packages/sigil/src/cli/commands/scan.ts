import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { Severity } from '../../core/index.js'
import { formatHuman, scanReport, toCheck, toSarif, worstSeverity } from '../../scan/index.js'
import { type Command, fmt } from '../command.js'

const SEVERITIES: Severity[] = ['info', 'low', 'medium', 'high', 'critical']

export const scan: Command = {
  name: 'scan',
  summary:
    'Statically scan a skill, capability or repo for malicious behaviour (OWASP Agentic Skills Top 10)',
  usage: 'sigil scan [path...] [--json] [--sarif <file>] [--fail-on <severity>]',
  options: {
    json: { type: 'boolean' },
    sarif: { type: 'string' },
    'fail-on': { type: 'string' },
    color: { type: 'boolean' },
    'no-color': { type: 'boolean' },
  },
  async run({ positionals, values }, ctx) {
    const failOn = String(values['fail-on'] ?? 'high') as Severity
    if (!SEVERITIES.includes(failOn)) {
      ctx.err(fmt.fail(`--fail-on must be one of ${SEVERITIES.join(', ')}`))
      return 2
    }
    const paths = positionals.length ? positionals : ['.']
    const report = await scanReport(paths, ctx.cwd)

    if (report.units.length === 0) {
      ctx.err(fmt.fail('nothing to scan (no files, skills or capabilities found)'))
      return 2
    }

    if (values.sarif) {
      const out = resolve(ctx.cwd, String(values.sarif))
      await mkdir(dirname(out), { recursive: true })
      await writeFile(out, `${JSON.stringify(toSarif(report), null, 2)}\n`)
      if (!values.json) ctx.out(fmt.ok(`SARIF written to ${out}`))
    }

    if (values.json) {
      ctx.out(JSON.stringify(toCheck(report), null, 2))
    } else {
      const color = values.color ? true : values['no-color'] ? false : undefined
      ctx.out(formatHuman(report, { color: color ?? Boolean(process.stdout.isTTY) }))
    }

    const worst = worstSeverity(report)
    if (worst && SEVERITIES.indexOf(worst) >= SEVERITIES.indexOf(failOn)) return 1
    return 0
  },
}
