import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ADAPTERS } from '../../src/compile/adapters.js'
import { DOCS_CHECKED } from '../../src/compile/agents.js'
import { renderSummaryTable } from '../../src/compile/matrix.js'

const doc = readFileSync(
  join(import.meta.dirname, '..', '..', '..', '..', 'docs', 'AGENTS-MATRIX.md'),
  'utf8',
)

describe('docs/AGENTS-MATRIX.md', () => {
  it('publishes exactly the support the adapters implement', () => {
    const generated = /<!-- sigil:matrix:begin -->\n([\s\S]*?)\n<!-- sigil:matrix:end -->/.exec(
      doc,
    )?.[1]
    // On failure, paste the expected table between the markers.
    expect(generated).toBe(renderSummaryTable())
  })

  it('links every source an adapter relies on', () => {
    const missing = [...new Set(ADAPTERS.flatMap((a) => a.sources))].filter(
      (url) => !doc.includes(url),
    )
    expect(missing).toEqual([])
  })

  it('dates every row of every source table with the day the docs were checked', () => {
    let inTable = false
    let rows = 0
    for (const line of doc.split('\n')) {
      if (!line.startsWith('|')) inTable = false
      else if (line.endsWith('| Checked |')) inTable = true
      else if (inTable && !line.startsWith('| ---')) {
        rows++
        expect(line, line).toMatch(new RegExp(`\\| ${DOCS_CHECKED} \\|$`))
      }
    }
    // Six per-agent tables (22-23 rows each) plus the policy and plugin tables.
    expect(rows).toBeGreaterThanOrEqual(140)
  })
})
