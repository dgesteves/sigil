import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { main } from '../../src/cli/main.js'
import { HostSandboxFactory } from '../../src/lab/sandbox/host.js'
import { findLabRoot } from '../../src/lab/session.js'
import { loadTask } from '../../src/lab/task.js'
import { checkTask } from '../../src/lab/validity.js'

function cli(cwd: string) {
  const lines: string[] = []
  const ctx = { cwd, out: (l = '') => lines.push(l), err: (l = '') => lines.push(l) }
  return { run: (argv: string[]) => main(argv, ctx), text: () => lines.join('\n') }
}

function repo(): string {
  const root = mkdtempSync(join(tmpdir(), 'sigil-cli-'))
  mkdirSync(join(root, 'tasks'))
  mkdirSync(join(root, 'catalog'))
  return root
}

describe('sigil task new', () => {
  it('scaffolds a task that is valid out of the box', async () => {
    const root = repo()
    const c = cli(root)
    expect(await c.run(['task', 'new', 'demo/fix-example'])).toBe(0)
    const task = await loadTask(join(root, 'tasks', 'demo', 'fix-example'))
    expect(task.suite).toBe('demo')
    const check = await checkTask(task, new HostSandboxFactory({ auth: 'token' }), { repeat: 1 })
    expect(check).toMatchObject({ ok: true, untouched: 1, solution: [0] })
    expect(await c.run(['task', 'new', 'demo/fix-example'])).toBe(1)
    expect(await c.run(['task', 'new', 'Bad Name'])).toBe(2)
  })
})

describe('sigil prove / task / lab usage', () => {
  it('lists the lab commands in help', async () => {
    const c = cli(repo())
    expect(await c.run(['--help'])).toBe(0)
    for (const name of ['prove', 'task', 'lab']) expect(c.text()).toContain(`  ${name}`)
  })

  it('explains usage errors instead of throwing', async () => {
    const root = repo()
    const c = cli(root)
    expect(await c.run(['prove'])).toBe(2)
    expect(await c.run(['prove', 'x/y', '--agent', 'codex'])).toBe(2)
    expect(c.text()).toMatch(/no lab driver for "codex" yet; available: claude-code/)
    expect(await c.run(['prove', 'x/y', '--runs', '0'])).toBe(2)
    expect(await c.run(['task', 'check', 'nope'])).toBe(2)
    expect(await c.run(['lab'])).toBe(2)
  })

  it('refuses to run a third-party capability on the host', async () => {
    const root = repo()
    const dir = join(root, 'catalog', 'skills', 'up', 'stream')
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'sigil.yaml'),
      [
        'sigil: 1',
        'id: up/stream',
        'type: skill',
        'version: 1.0.0',
        'name: Upstream skill',
        'summary: A third-party skill that Sigil lists but does not host.',
        'domains: [frontend]',
        'license: MIT',
        'authors: [{ github: someone }]',
        'source: { repo: "https://github.com/someone/skills", ref: "0123456789abcdef0123456789abcdef01234567" }',
        'payload: { format: agent-skill, entry: SKILL.md }',
        'targets: [claude-code]',
        '',
      ].join('\n'),
    )
    const c = cli(root)
    expect(await c.run(['prove', 'catalog/skills/up/stream', '--host', '--suite', 'x'])).toBe(2)
    expect(c.text()).toMatch(/third-party capability .* never runs on the host/)
  })

  it('finds the repo by its tasks/ directory before a stray catalog/', async () => {
    const outer = mkdtempSync(join(tmpdir(), 'sigil-root-'))
    mkdirSync(join(outer, 'catalog'))
    mkdirSync(join(outer, 'repo', 'tasks'), { recursive: true })
    mkdirSync(join(outer, 'repo', 'deep'))
    expect(await findLabRoot(join(outer, 'repo', 'deep'))).toBe(join(outer, 'repo'))
  })
})
