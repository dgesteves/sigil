import { createHash } from 'node:crypto'
import type { Severity } from '../core/index.js'
import { RULE_META } from './rules/index.js'
import type { Rule } from './rules/rule.js'
import { TOOL_NAME, TOOL_VERSION } from './scan.js'
import type { ScanFinding, ScanReport } from './types.js'

const INFO_URI = 'https://github.com/dgesteves/sigil/blob/main/packages/sigil/src/scan/RULES.md'
const OWASP_URI = 'https://owasp.org/www-project-agentic-skills-top-10/'

/** SARIF level accepted by GitHub code scanning. */
function level(sev: Severity): 'error' | 'warning' | 'note' {
  if (sev === 'critical' || sev === 'high') return 'error'
  if (sev === 'medium') return 'warning'
  return 'note'
}

/** GitHub ranks findings by this 0–10 string. */
function securitySeverity(sev: Severity): string {
  return { critical: '9.5', high: '8.0', medium: '5.0', low: '3.0', info: '1.0' }[sev]
}

const OWASP_NAMES: Record<string, string> = {
  AST01: 'Malicious Skills',
  AST02: 'Supply Chain Compromise',
  AST03: 'Over-Privileged Skills',
  AST04: 'Insecure Metadata',
  AST05: 'Untrusted External Instructions',
  AST06: 'Weak Isolation',
  AST07: 'Update Drift',
  AST08: 'Poor Scanning',
  AST09: 'No Governance',
  AST10: 'Cross-Platform Reuse',
}

/** A valid SARIF 2.1.0 log. Only rules that produced results are emitted, each with full help text. */
export function toSarif(report: ScanReport): object {
  const results: object[] = []
  const ruleIndex = new Map<string, number>()
  const rules: object[] = []
  const taxaUsed = new Set<string>()

  const ruleRef = (id: string): number => {
    const existing = ruleIndex.get(id)
    if (existing !== undefined) return existing
    const meta = RULE_META.get(id)
    const idx = rules.length
    ruleIndex.set(id, idx)
    rules.push(descriptor(id, meta))
    if (meta?.owasp) taxaUsed.add(meta.owasp)
    return idx
  }

  for (const unit of report.units) {
    for (const f of unit.findings) {
      const idx = ruleRef(f.rule)
      results.push(result(f, idx))
    }
  }

  const taxa = [...taxaUsed].sort().map((id) => ({
    id,
    name: OWASP_NAMES[id] ?? id,
    shortDescription: { text: `OWASP ${id}: ${OWASP_NAMES[id] ?? id}` },
    helpUri: OWASP_URI,
  }))

  return {
    $schema:
      'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/sarif-2.1/schema/sarif-schema-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: TOOL_NAME,
            version: TOOL_VERSION,
            semanticVersion: TOOL_VERSION,
            informationUri: INFO_URI,
            rules,
            ...(taxa.length
              ? {
                  supportedTaxonomies: [{ name: 'OWASP-Agentic-Skills-Top-10' }],
                }
              : {}),
          },
        },
        ...(taxa.length
          ? {
              taxonomies: [
                {
                  name: 'OWASP-Agentic-Skills-Top-10',
                  informationUri: OWASP_URI,
                  organization: 'OWASP',
                  shortDescription: { text: 'OWASP Agentic Skills Top 10' },
                  taxa,
                },
              ],
            }
          : {}),
        results,
        columnKind: 'unicodeCodePoints',
        originalUriBaseIds: { SRCROOT: { uri: `file://${report.root}/` } },
      },
    ],
  }
}

function descriptor(id: string, meta: Rule | undefined): object {
  const sev = meta?.severity ?? 'medium'
  const tags = ['security', `sigil/${meta?.family ?? 'rule'}`]
  if (meta?.owasp) tags.push(`external/owasp/${meta.owasp}`)
  return {
    id,
    name: meta?.name ?? id,
    shortDescription: { text: meta?.title ?? id },
    fullDescription: { text: meta?.help ?? '' },
    help: {
      text: `${meta?.help ?? ''}\n\nKnown false positives: ${meta?.falsePositives ?? 'none noted'}`,
      markdown: `${meta?.help ?? ''}\n\n**Known false positives:** ${meta?.falsePositives ?? 'none noted'}\n\nSuppress with \`sigil-scan-ignore ${id}: <reason>\` on the line before${meta && meta.suppressible === false ? ' — but this rule cannot be suppressed' : ''}.`,
    },
    helpUri: INFO_URI,
    defaultConfiguration: { level: level(sev) },
    properties: {
      tags,
      'security-severity': securitySeverity(sev),
      ...(meta?.owasp ? { owasp: meta.owasp } : {}),
    },
    ...(meta?.owasp
      ? {
          relationships: [
            {
              target: { id: meta.owasp, toolComponent: { name: 'OWASP-Agentic-Skills-Top-10' } },
              kinds: ['superset'],
            },
          ],
        }
      : {}),
  }
}

function result(f: ScanFinding, ruleIndex: number): object {
  const uri = f.file ?? '.'
  const region = f.line ? { startLine: f.line } : undefined
  const fp = createHash('sha256')
    .update(`${f.rule}:${uri}:${f.line ?? 0}:${f.message}`)
    .digest('hex')
    .slice(0, 16)
  return {
    ruleId: f.rule,
    ruleIndex,
    level: level(f.severity),
    message: { text: f.message },
    locations: [
      {
        physicalLocation: {
          artifactLocation: { uri, uriBaseId: 'SRCROOT' },
          ...(region ? { region } : {}),
        },
      },
    ],
    partialFingerprints: { sigilScan: fp },
    properties: {
      'security-severity': securitySeverity(f.suppressed?.severity ?? f.severity),
      kind: f.kind,
    },
    ...(f.suppressed
      ? { suppressions: [{ kind: 'external', justification: f.suppressed.reason }] }
      : {}),
  }
}
