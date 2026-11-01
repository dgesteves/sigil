// False-positive and recall benchmark for `sigil scan`.
//
// Reads public research corpora from a scratch dir OUTSIDE the repo (never committed, never executed)
// and reports finding counts by severity per repo. Clone the corpora first, at the SHAs recorded in
// BENCHMARK.md, e.g.:
//   mkdir -p /private/tmp/claude-501/sigil-scan-bench/{benign,malicious}
//   git -C .../benign clone --depth 1 https://github.com/anthropics/skills ...
// then: node packages/sigil/scripts/scan-bench.mjs
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url))
const ROOT = process.argv[2] ?? '/private/tmp/claude-501/sigil-scan-bench'
const REPOS = {
  'benign/anthropics_skills': 'precision',
  'benign/obra_superpowers': 'precision',
  'benign/vercel-labs_agent-skills': 'precision',
  'malicious/snyk-labs_toxicskills-goof': 'recall',
  'malicious/trailofbits_overtly-malicious-skills': 'recall',
}
const ORDER = ['critical', 'high', 'medium', 'low', 'info']

for (const [rel, kind] of Object.entries(REPOS)) {
  const dir = `${ROOT}/${rel}`
  if (!existsSync(dir)) {
    console.log(`${rel}: (not cloned)`)
    continue
  }
  let json
  try {
    json = execFileSync('node', [CLI, 'scan', dir, '--json'], {
      encoding: 'utf8',
      maxBuffer: 64 << 20,
    })
  } catch (e) {
    // scan exits non-zero when it finds something at/above --fail-on; that is expected.
    json = e.stdout?.toString() ?? '{}'
  }
  const findings = JSON.parse(json).findings ?? []
  const counts = Object.fromEntries(ORDER.map((s) => [s, 0]))
  for (const f of findings) counts[f.severity]++
  const line =
    ORDER.filter((s) => counts[s])
      .map((s) => `${counts[s]} ${s}`)
      .join(', ') || 'clean'
  console.log(`${rel} [${kind}]: ${line}`)
}
