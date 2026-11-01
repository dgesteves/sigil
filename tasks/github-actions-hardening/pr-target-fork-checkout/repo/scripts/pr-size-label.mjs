#!/usr/bin/env node
// Labels a pull request by how many lines it changes. Used by .github/workflows/pr-triage.yml.
import { execFileSync } from 'node:child_process'
import { SIZE_LABELS, sizeLabel } from './pr-size.mjs'

const pr = process.env.PR_NUMBER
const lines = Number(process.env.ADDITIONS) + Number(process.env.DELETIONS)
if (!pr || Number.isNaN(lines)) {
  console.error('PR_NUMBER, ADDITIONS and DELETIONS must be set')
  process.exit(1)
}

const label = sizeLabel(lines)
const stale = SIZE_LABELS.filter((l) => l !== label)
execFileSync('gh', ['pr', 'edit', pr, '--add-label', label, '--remove-label', stale.join(',')], {
  stdio: 'inherit',
})
console.log(`#${pr}: ${lines} lines changed, labelled ${label}`)
