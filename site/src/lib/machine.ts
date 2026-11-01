/**
 * What agents read. The machine view, /llms.txt and /c/<id>.md all come from these functions, so a
 * page and its machine form can never disagree.
 */
import type { RegistryEntry } from 'sigil/core'
import {
  AGENT_LABEL,
  AGENTS,
  type CapView,
  LEVEL,
  pp,
  REPO_URL,
  shortDigest,
  summariseUplift,
  TYPE_LABEL,
  VERDICT,
} from './model'

export interface Meta {
  demo: boolean
  source: string
  generatedAt: string
  commit?: string
}

const ci = (lo: number, hi: number) => `[${pp(lo)}, ${pp(hi)}]`

function header(meta: Meta) {
  return [
    meta.demo
      ? '> **DEMO DATA.** Simulated runs for site development. None of this is a measurement.\n'
      : '',
    `- source: ${meta.source}`,
    `- generated: ${meta.generatedAt}`,
    `- commit: ${meta.commit ?? 'unknown'}`,
  ]
    .filter(Boolean)
    .join('\n')
}

export function registryMarkdown(views: CapView[], meta: Meta): string {
  const proven = views.filter((v) => v.uplift === 'proven').length
  const rows = views
    .map(
      (v) =>
        `| ${v.id} | ${TYPE_LABEL[v.type]} | ${v.level} | ${v.uplift} | ${v.lead ? `${pp(v.lead.delta)} ${ci(...v.lead.ci95)}` : '—'} | ${v.runs} | ${shortDigest(v.digest)} |`,
    )
    .join('\n')
  return `# Sigil registry

Every AI agent capability, proven. ${views.length} capabilities, ${proven} proven.

${header(meta)}

Uplift is the treatment pass rate minus the baseline pass rate on hidden tests, in percentage points,
with a 95% Newcombe interval. A verdict follows from the interval, never from the point estimate.

| id | type | level | uplift | Δ pts [95% CI] | runs | digest |
| --- | --- | --- | --- | --- | --- | --- |
${rows || '| (none yet) | | | | | | |'}

## Endpoints

- /registry.json — the full registry (manifests, digests, files, evidence)
- /c/<namespace>/<slug>.md — one capability, as markdown
- /llms.txt — this index for language models
- /method — how proof works

## Produce proof

\`\`\`sh
npx sigil prove catalog/<type>/<namespace>/<slug> --suite <suite> --runs 6
\`\`\`
`
}

export function capabilityMarkdown(entry: RegistryEntry, view: CapView, meta: Meta): string {
  const m = entry.manifest
  const ev = entry.evidence
  const current = ev && ev.digest === entry.digest ? ev : undefined
  const runs = summariseUplift(entry)
  const lines: string[] = []
  lines.push(
    `# ${m.name}`,
    '',
    `\`${m.id}\` · ${TYPE_LABEL[m.type]} · v${m.version}`,
    '',
    m.summary,
    '',
  )
  if (meta.demo)
    lines.push('> **DEMO DATA.** Simulated for site development. Not a real capability.', '')
  if (m.description) lines.push(m.description, '')
  lines.push('## Verdict', '')
  lines.push(`- level: **${entry.level}** — ${LEVEL[entry.level].line}`)
  lines.push(`- uplift: **${entry.uplift}** — ${VERDICT[entry.uplift].line}`)
  if (view.stale) lines.push('- evidence on file is for a different digest and counts for nothing')
  lines.push(`- digest: \`${entry.digest}\``, '')
  if (runs.length) {
    lines.push(
      '## Uplift runs',
      '',
      '| agent | model | suite | tasks | baseline | treatment | Δ pts | 95% CI | verdict |',
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    )
    for (const r of runs)
      lines.push(
        `| ${r.agent} | ${r.model} | ${r.suite} | ${r.tasks} | ${r.baseline.passed}/${r.baseline.runs} | ${r.treatment.passed}/${r.treatment.runs} | ${pp(r.delta)} | ${ci(...r.ci95)} | ${r.verdict} |`,
      )
    lines.push('')
    for (const u of current?.uplift ?? []) {
      lines.push(
        `### ${u.suite} (${u.agent.id} ${u.agent.version}, ${u.model})`,
        '',
        '| task | baseline | treatment | tampered | false done |',
        '| --- | --- | --- | --- | --- |',
      )
      for (const t of u.tasks)
        lines.push(
          `| ${t.task} | ${t.baseline.passed}/${t.baseline.runs} | ${t.treatment.passed}/${t.treatment.runs} | ${t.baseline.tampered + t.treatment.tampered} | ${t.baseline.falseDone + t.treatment.falseDone} |`,
        )
      lines.push('')
    }
  } else {
    lines.push(
      '## Uplift runs',
      '',
      'None for this digest. Untested is not the same as useless: nobody has measured it yet.',
      '',
    )
  }
  lines.push('## Security', '')
  if (current) {
    lines.push(
      `- static scan: ${current.security.status} (${current.security.tool.name} ${current.security.tool.version})`,
    )
    for (const f of current.security.findings)
      lines.push(
        `  - ${f.severity} ${f.rule}${f.owasp ? ` (${f.owasp})` : ''}: ${f.message}${f.file ? ` — ${f.file}${f.line ? `:${f.line}` : ''}` : ''}`,
      )
    lines.push(
      `- canary sandbox: ${current.canary ? `${current.canary.status}, ${current.canary.runs} runs` : 'not run'}`,
    )
    for (const e of current.canary?.events ?? []) lines.push(`  - ${e.kind}: ${e.detail}`)
    if (current.revoked) lines.push(`- revoked ${current.revoked.at}: ${current.revoked.reason}`)
  } else lines.push('No checks recorded for this digest.')
  lines.push(
    '',
    '## Compatibility',
    '',
    '| agent | targeted | compiled | evaluated |',
    '| --- | --- | --- | --- |',
  )
  for (const a of AGENTS) {
    const c = current?.compat[a]
    const targeted = m.targets.includes(a)
    if (!targeted && !c) continue
    lines.push(
      `| ${AGENT_LABEL[a]} | ${targeted ? 'yes' : 'no'} | ${c ? (c.compiled ? 'yes' : 'no') : 'no record'} | ${c ? (c.evaluated ? 'yes' : 'no') : 'no record'} |`,
    )
  }
  lines.push('', '## Permissions', '')
  lines.push(
    `- network: ${m.permissions.network.length ? m.permissions.network.join(', ') : 'none'}`,
  )
  lines.push(`- shell: ${m.permissions.shell.length ? m.permissions.shell.join(', ') : 'none'}`)
  lines.push(`- filesystem: ${m.permissions.filesystem}`)
  lines.push(`- env: ${m.permissions.env.length ? m.permissions.env.join(', ') : 'none'}`)
  lines.push('', '## Files', '')
  for (const f of entry.files) lines.push(`- \`${f.path}\` ${f.bytes} B sha256:${f.sha256}`)
  if (m.limitations.length) {
    lines.push('', '## Limitations', '')
    for (const l of m.limitations) lines.push(`- ${l}`)
  }
  lines.push(
    '',
    '## Install',
    '',
    '```sh',
    `npx sigil add ${m.id} --agent ${m.targets.slice(0, 3).join(',')}`,
    '```',
    '',
  )
  lines.push(`Source: ${REPO_URL}/tree/${meta.commit ?? 'main'}/${entry.path}`)
  return lines.join('\n')
}

export function llmsTxt(views: CapView[], meta: Meta, base: string): string {
  const list = views
    .map(
      (v) =>
        `- [${v.name}](${base}/c/${v.ns}/${v.slug}.md): ${v.summary} (${v.level}, uplift ${v.uplift}${v.lead ? ` ${pp(v.lead.delta)} pts ${ci(...v.lead.ci95)}` : ''})`,
    )
    .join('\n')
  return `# Sigil

> Every AI agent capability, proven. The open proving ground for agent skills, rules, hooks,
> subagents and MCP servers: A/B runs on hidden tests, a canary sandbox, a sealed payload digest,
> and one install for every coding agent.
${meta.demo ? '\n> DEMO DATA: this deployment reads a development fixture. Nothing below is a measurement.\n' : ''}
Every number is computed from recorded runs. Untested means nobody has measured it yet.

## Data

- [Registry (JSON)](${base}/registry.json): manifests, digests, files and evidence
- [Method](${base}/method): how uplift, intervals, canaries and seals work
- [Source](${REPO_URL})

## Capabilities

${list || '- none yet: run `npx sigil prove` to produce the first result'}
`
}
