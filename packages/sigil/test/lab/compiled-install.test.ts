import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveCapability } from '../../src/lab/capability.js'
import { compiledInstallFiles, LabInstallError } from '../../src/lab/compiled-install.js'

const catalog = join(import.meta.dirname, '..', 'fixtures', 'compile', 'repo', 'catalog')
const cap = (path: string) => resolveCapability(join(catalog, path), process.cwd())
const emptyRepo = () => mkdtempSync(join(tmpdir(), 'sigil-lab-repo-'))

describe('compiledInstallFiles: the lab installs exactly what sigil add writes', () => {
  it('copies a skill for Claude Code and never leaks the lockfile', async () => {
    const files = await compiledInstallFiles(
      await cap('skills/demo/hello-skill'),
      'claude-code',
      emptyRepo(),
    )
    expect(files.map((f) => f.path)).toEqual([
      '.claude/skills/hello-skill/SKILL.md',
      '.claude/skills/hello-skill/references/style.md',
    ])
    expect(files.some((f) => f.path === 'sigil.lock.json')).toBe(false)
  })

  it('installs formats the old skill-only installer could not: rules, commands, subagents', async () => {
    for (const path of ['rules/demo/ts-style', 'commands/demo/review', 'agents/demo/reviewer']) {
      const files = await compiledInstallFiles(await cap(path), 'claude-code', emptyRepo())
      expect(files.length, path).toBeGreaterThan(0)
      expect(
        files.every((f) => f.path.startsWith('.claude/') || f.path === 'CLAUDE.md'),
        path,
      ).toBe(true)
    }
  })

  it('merges an MCP server into the task repo’s existing config without dropping its entries', async () => {
    const repo = emptyRepo()
    writeFileSync(
      join(repo, '.mcp.json'),
      `${JSON.stringify({ mcpServers: { existing: { command: 'x' } } }, null, 2)}\n`,
    )
    const files = await compiledInstallFiles(
      await cap('mcp-servers/demo/files'),
      'claude-code',
      repo,
    )
    const mcp = files.find((f) => f.path === '.mcp.json')
    expect(mcp).toBeDefined()
    const merged = JSON.parse(mcp!.content.toString('utf8')) as {
      mcpServers: Record<string, unknown>
    }
    expect(Object.keys(merged.mcpServers)).toContain('existing')
    expect(Object.keys(merged.mcpServers).length).toBeGreaterThan(1)
  })

  it('returns only new or changed files, never the rest of the repo', async () => {
    const repo = emptyRepo()
    mkdirSync(join(repo, 'src'))
    writeFileSync(join(repo, 'src', 'index.ts'), 'export {}\n')
    const files = await compiledInstallFiles(
      await cap('skills/demo/hello-skill'),
      'claude-code',
      repo,
    )
    expect(files.some((f) => f.path.startsWith('src/'))).toBe(false)
  })

  it('refuses a combination the agent cannot load', async () => {
    await expect(
      compiledInstallFiles(await cap('hooks/demo/guard'), 'aider', emptyRepo()),
    ).rejects.toBeInstanceOf(LabInstallError)
  })
})
