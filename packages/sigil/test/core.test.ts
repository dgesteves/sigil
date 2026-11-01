import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { main } from '../src/cli/main.js'
import {
  buildRegistry,
  digestDir,
  type Evidence,
  levelOf,
  loadCapability,
  Manifest,
  newcombe,
  pool,
  upliftOf,
  verdictFor,
  wilson,
} from '../src/core/index.js'

const fx = (p: string) => join(import.meta.dirname, 'fixtures', p)
const good = fx('good/catalog/skills/demo/hello-skill')

describe('digest', () => {
  it('matches the documented coreutils pipeline', async () => {
    const { digest } = await digestDir(good)
    const shell = execFileSync(
      'sh',
      [
        '-c',
        `find . -type f ! -name sigil.yaml ! -name evidence.json ! -name .DS_Store ! -path './.git/*' | sed 's|^\\./||' | LC_ALL=C sort | while IFS= read -r f; do shasum -a 256 "$f"; done | shasum -a 256`,
      ],
      { cwd: good, encoding: 'utf8' },
    )
    expect(digest).toBe(`sha256:${shell.split(' ')[0]}`)
  })

  it('ignores the manifest and evidence but not payload edits', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sigil-'))
    cpSync(good, dir, { recursive: true })
    const before = (await digestDir(dir)).digest
    writeFileSync(join(dir, 'sigil.yaml'), 'changed: true\n')
    writeFileSync(join(dir, 'evidence.json'), '{}')
    expect((await digestDir(dir)).digest).toBe(before)
    writeFileSync(join(dir, 'references', 'style.md'), 'Be loud.\n')
    expect((await digestDir(dir)).digest).not.toBe(before)
  })

  it('rejects symlinks', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sigil-'))
    cpSync(good, dir, { recursive: true })
    symlinkSync('/etc/hosts', join(dir, 'hosts'))
    await expect(digestDir(dir)).rejects.toThrow(/symbolic links/)
  })
})

describe('manifest', () => {
  const base = {
    sigil: 1,
    id: 'demo/x',
    type: 'skill',
    version: '1.0.0',
    name: 'X skill',
    summary: 'A summary that is long enough.',
    domains: ['frontend'],
    license: 'MIT',
    authors: [{ github: 'dgesteves' }],
    payload: { format: 'agent-skill', entry: 'SKILL.md' },
    targets: ['claude-code'],
  }

  it('applies safe permission defaults', () => {
    const m = Manifest.parse(base)
    expect(m.permissions).toEqual({ network: [], shell: [], filesystem: 'read', env: [] })
  })

  it('rejects a payload format that does not fit the type', () => {
    const r = Manifest.safeParse({ ...base, type: 'hook' })
    expect(r.success).toBe(false)
    expect(r.error?.issues[0]?.message).toMatch(/expects payload.format "hook"/)
  })

  it('rejects floating refs for external sources', () => {
    const r = Manifest.safeParse({
      ...base,
      source: { repo: 'https://github.com/a/b', ref: 'main' },
    })
    expect(r.success).toBe(false)
  })

  it('rejects unknown keys', () => {
    expect(Manifest.safeParse({ ...base, verified: true }).success).toBe(false)
  })
})

describe('load', () => {
  it('accepts a valid skill', async () => {
    const r = await loadCapability(good, { root: fx('good') })
    expect(r.findings).toEqual([])
    expect(r.manifest?.id).toBe('demo/hello-skill')
    expect(r.files.map((f) => f.path)).toEqual(['SKILL.md', 'references/style.md'])
  })

  it('flags a directory that does not match the slug', async () => {
    const r = await loadCapability(fx('bad-name/catalog/skills/demo/wrong-dir'))
    expect(r.findings.map((f) => f.rule)).toContain('SIG-STR-005')
  })

  it('flags broken relative links and a SKILL.md name mismatch', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sigil-'))
    const cap = join(dir, 'broken-link')
    cpSync(fx('broken-link/catalog/skills/demo/broken-link'), cap, { recursive: true })
    const r = await loadCapability(cap)
    expect(r.findings.map((f) => f.rule)).toContain('SIG-STR-010')
  })
})

describe('stats', () => {
  it('wilson interval is sane at the edges', () => {
    const [lo, hi] = wilson(0, 10)
    expect(lo).toBe(0)
    expect(hi).toBeGreaterThan(0.25)
    expect(hi).toBeLessThan(0.35)
  })

  it('newcombe matches the published worked example', () => {
    // Newcombe (1998) example: 56/70 vs 48/80 → difference 0.2, 95% CI 0.0524 to 0.3339
    const [lo, hi] = newcombe(48, 80, 56, 70)
    expect(lo).toBeCloseTo(0.0524, 3)
    expect(hi).toBeCloseTo(0.3339, 3)
  })

  it('never issues a verdict on too few runs', () => {
    expect(verdictFor([0.2, 0.9], 3, 3)).toBe('inconclusive')
  })

  it('pools tasks and calls a clear win proven', () => {
    const t = (passed: number, runs: number) => ({ passed, runs, tampered: 0, falseDone: 0 })
    const p = pool([
      { baseline: t(2, 10), treatment: t(9, 10) },
      { baseline: t(3, 10), treatment: t(8, 10) },
    ])
    expect(p.delta).toBeCloseTo(0.6)
    expect(p.verdict).toBe('proven')
  })
})

describe('level', () => {
  const at = '2026-11-01T00:00:00.000Z'
  const evidence = (over: Partial<Evidence> = {}): Evidence => ({
    sigil: 1,
    capability: 'demo/hello-skill',
    version: '1.0.0',
    digest: `sha256:${'a'.repeat(64)}`,
    generatedAt: at,
    structure: { status: 'pass', tool: { name: 'sigil', version: '0.0.0' }, at, findings: [] },
    security: { status: 'pass', tool: { name: 'sigil-scan', version: '0.0.0' }, at, findings: [] },
    compat: {},
    uplift: [],
    reviews: [],
    ...over,
  })
  const digest = `sha256:${'a'.repeat(64)}`

  it('drops to submitted when the content changed', () => {
    expect(levelOf({ digest: `sha256:${'b'.repeat(64)}`, evidence: evidence() })).toBe('submitted')
  })

  it('needs a canary pass and an approved review to be verified', () => {
    expect(levelOf({ digest, evidence: evidence() })).toBe('validated')
    const canary = {
      status: 'pass' as const,
      agent: { id: 'claude-code' as const, version: '2' },
      model: 'm',
      at,
      runs: 3,
      events: [],
    }
    expect(levelOf({ digest, evidence: evidence({ canary }) })).toBe('validated')
    expect(
      levelOf({
        digest,
        evidence: evidence({ canary, reviews: [{ by: 'dgesteves', at, decision: 'approved' }] }),
      }),
    ).toBe('verified')
  })

  it('treats a high security finding as blocking', () => {
    const security = {
      status: 'warn' as const,
      tool: { name: 'sigil-scan', version: '0' },
      at,
      findings: [{ rule: 'SIG-SEC-001', severity: 'high' as const, message: 'x' }],
    }
    expect(levelOf({ digest, evidence: evidence({ security }) })).toBe('submitted')
  })

  it('reports harm over proof', () => {
    const run = (verdict: 'proven' | 'harmful') => ({
      agent: { id: 'claude-code' as const, version: '2' },
      model: 'm',
      suite: 's',
      suiteDigest: digest,
      at,
      tasks: [
        {
          task: 't',
          baseline: { passed: 1, runs: 1, tampered: 0, falseDone: 0 },
          treatment: { passed: 1, runs: 1, tampered: 0, falseDone: 0 },
        },
      ],
      delta: 0,
      ci95: [0, 0] as [number, number],
      verdict,
    })
    expect(upliftOf(evidence({ uplift: [run('proven'), run('harmful')] }), digest)).toBe('harmful')
  })
})

describe('registry + cli', () => {
  it('builds a registry from the catalog', async () => {
    const { registry, rejected } = await buildRegistry(fx('good'), { now: new Date(0) })
    expect(rejected).toEqual([])
    expect(registry.capabilities).toHaveLength(1)
    expect(registry.capabilities[0]).toMatchObject({
      level: 'submitted',
      uplift: 'untested',
      path: 'catalog/skills/demo/hello-skill',
    })
  })

  it('sigil validate exits 0 on a valid catalog and 1 on an invalid one', async () => {
    const lines: string[] = []
    const ctx = (cwd: string) => ({
      cwd,
      out: (l = '') => lines.push(l),
      err: (l = '') => lines.push(l),
    })
    expect(await main(['validate'], ctx(fx('good')))).toBe(0)
    expect(await main(['validate', 'catalog'], ctx(fx('bad-name')))).toBe(1)
  })
})
