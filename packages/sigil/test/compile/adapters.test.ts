// biome-ignore-all lint/suspicious/noTemplateCurlyInString: agent configs use literal ${VAR} references
import { describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'
import { ADAPTERS, GAPS, lookup } from '../../src/compile/adapters.js'
import { compile } from '../../src/compile/compile.js'
import { parseRule } from '../../src/compile/formats/rule.js'
import type { AdapterResult, CapabilityInput, FileOp, WriteOp } from '../../src/compile/types.js'
import { AGENTS, type AgentId } from '../../src/core/ids.js'
import { inline, input } from './helpers.js'

const FIXTURES: Record<string, string> = {
  'agent-skill': 'skills/demo/hello-skill',
  rule: 'rules/demo/ts-style',
  command: 'commands/demo/review',
  subagent: 'agents/demo/reviewer',
  hook: 'hooks/demo/guard',
  'mcp-server': 'mcp-servers/demo/files',
  policy: 'policies/demo/no-secrets',
  plugin: 'collections/demo/pack',
}

function one(cap: CapabilityInput, agent: AgentId): AdapterResult {
  return compile(cap, [agent]).results[0]!.result
}

function supported(r: AdapterResult): { ops: WriteOp[]; notes: string[] } {
  if (r.status !== 'supported') throw new Error(`expected supported, got: ${r.reason}`)
  return { ops: r.ops, notes: r.notes.map((n) => n.message) }
}

function file(r: AdapterResult, path: string): string {
  const op = supported(r).ops.find((o): o is FileOp => o.kind === 'file' && o.path === path)
  if (!op)
    throw new Error(
      `no file ${path} in ${supported(r)
        .ops.map((o) => o.path)
        .join(', ')}`,
    )
  return op.content.toString('utf8')
}

const frontmatter = (text: string) =>
  parseYaml(/^---\n([\s\S]*?)\n---/.exec(text)![1]!) as Record<string, unknown>

describe('adapter registry', () => {
  it('cites official sources for every supported combination and a reason for every gap', () => {
    for (const a of ADAPTERS) {
      expect(a.sources.length, `${a.format}:${a.agent}`).toBeGreaterThan(0)
      for (const s of a.sources) expect(s).toMatch(/^https:\/\//)
    }
    for (const g of GAPS) expect(g.reason.length, `${g.format}:${g.agent}`).toBeGreaterThan(10)
  })

  it('reports combinations nobody researched as unresearched, never as supported', () => {
    expect(lookup('plugin', 'warp').status).toBe('unresearched')
    const r = one(
      { manifest: { payload: { format: 'plugin' } } } as unknown as CapabilityInput,
      'warp',
    )
    expect(r.status).toBe('unsupported')
  })

  it('compiles every adapter against a fixture of its format without throwing', async () => {
    for (const a of ADAPTERS) {
      const cap = await input(FIXTURES[a.format]!)
      const ctx = { pickDir: (d: readonly string[]) => d[0]!, exists: () => false }
      const r = a.compile(cap, ctx)
      if (r.status === 'supported') {
        expect(r.ops.length, `${a.format}:${a.agent}`).toBeGreaterThan(0)
        for (const op of r.ops) expect(op.path).not.toMatch(/^\/|\.\./)
      } else {
        expect(r.reason.length).toBeGreaterThan(10)
      }
    }
  })
})

describe('skills', () => {
  it('copies the folder byte for byte', async () => {
    const cap = await input(FIXTURES['agent-skill']!)
    const r = one(cap, 'claude-code')
    expect(supported(r).ops.map((o) => o.path)).toEqual([
      '.claude/skills/hello-skill/SKILL.md',
      '.claude/skills/hello-skill/references/style.md',
    ])
    expect(file(r, '.claude/skills/hello-skill/SKILL.md')).toBe(cap.files[0]!.content.toString())
  })

  it('shares .agents/skills between agents and reuses .claude/skills where an agent reads it', async () => {
    const cap = await input(FIXTURES['agent-skill']!)
    const c = compile(cap, ['codex', 'gemini-cli', 'opencode'])
    expect(new Set(c.ops.map((o) => o.op.path.split('/').slice(0, 2).join('/')))).toEqual(
      new Set(['.agents/skills']),
    )
    expect(c.ops[0]!.agents).toEqual(['codex', 'gemini-cli', 'opencode'])
    const withClaude = compile(cap, ['claude-code', 'cursor'])
    expect(withClaude.ops.every((o) => o.op.path.startsWith('.claude/skills/'))).toBe(true)
    expect(withClaude.ops[0]!.agents).toEqual(['claude-code', 'cursor'])
  })

  it('is unsupported where the agent has no skills', async () => {
    expect(one(await input(FIXTURES['agent-skill']!), 'aider').status).toBe('unsupported')
  })
})

describe('rules', () => {
  it('classifies activation from Cursor-style frontmatter', () => {
    expect(parseRule('---\nalwaysApply: true\n---\nx').activation.mode).toBe('always')
    expect(parseRule('---\nglobs: a/**, b/**\n---\nx').activation).toEqual({
      mode: 'files',
      globs: ['a/**', 'b/**'],
    })
    expect(parseRule('---\ndescription: when testing\n---\nx').activation.mode).toBe('agent')
    expect(parseRule('plain body').activation.mode).toBe('manual')
  })

  it('maps globs to each agent own field', async () => {
    const cap = await input(FIXTURES.rule!)
    const fm = (agent: AgentId, path: string) => frontmatter(file(one(cap, agent), path))
    expect(fm('cursor', '.cursor/rules/ts-style.mdc')).toEqual({
      description: 'TypeScript conventions for this repository',
      globs: 'src/**/*.ts,test/**/*.ts',
      alwaysApply: false,
    })
    expect(fm('claude-code', '.claude/rules/ts-style.md')).toEqual({
      paths: ['src/**/*.ts', 'test/**/*.ts'],
    })
    expect(fm('github-copilot', '.github/instructions/ts-style.instructions.md').applyTo).toBe(
      'src/**/*.ts,test/**/*.ts',
    )
    expect(fm('kiro', '.kiro/steering/ts-style.md')).toEqual({
      inclusion: 'fileMatch',
      fileMatchPattern: ['src/**/*.ts', 'test/**/*.ts'],
    })
    expect(fm('cline', '.cline/rules/ts-style.md')).toEqual({
      paths: ['src/**/*.ts', 'test/**/*.ts'],
    })
    expect(fm('qwen-code', '.qwen/rules/ts-style.md').paths).toEqual([
      'src/**/*.ts',
      'test/**/*.ts',
    ])
    expect(fm('trae', '.trae/rules/ts-style.md').globs).toBe('src/**/*.ts,test/**/*.ts')
    expect(file(one(cap, 'cursor'), '.cursor/rules/ts-style.mdc')).toContain(
      'Prefer `unknown` over `any`',
    )
  })

  it('refuses what an agent cannot express instead of guessing', async () => {
    const cap = await input(FIXTURES.rule!)
    expect(one(cap, 'windsurf')).toMatchObject({
      status: 'unsupported',
      reason: expect.stringMatching(/single glob/),
    })
    const manual = await inline(FIXTURES.rule!, { 'rule.md': 'Only when asked.\n' })
    expect(one(manual, 'claude-code').status).toBe('unsupported')
    expect(frontmatter(file(one(manual, 'cursor'), '.cursor/rules/ts-style.mdc'))).toEqual({
      alwaysApply: false,
    })
  })

  it('puts the rule in a marked AGENTS.md block, warning that file scope is lost', async () => {
    const cap = await input(FIXTURES.rule!)
    const c = compile(cap, ['codex', 'opencode', 'amp'])
    expect(c.ops).toHaveLength(1)
    expect(c.ops[0]).toMatchObject({
      op: { kind: 'block', path: 'AGENTS.md', id: 'demo/ts-style' },
      agents: ['codex', 'opencode', 'amp'],
    })
    expect(supported(c.results[0]!.result).notes.join()).toMatch(/cannot scope rules to files/)
    expect(one(cap, 'gemini-cli')).toMatchObject({
      status: 'supported',
      ops: [{ path: 'GEMINI.md' }],
    })
  })

  it('warns when creating AGENTS.md would hide CLAUDE.md from agents that fall back to it', async () => {
    const cap = await input(FIXTURES.rule!)
    const c = compile(cap, ['opencode'], { exists: (p) => p === 'CLAUDE.md' })
    expect(supported(c.results[0]!.result).notes.join()).toMatch(/stop reading CLAUDE.md/)
  })
})

describe('commands', () => {
  it('copies Claude Code commands verbatim and translates $ARGUMENTS for Gemini CLI', async () => {
    const cap = await input(FIXTURES.command!)
    expect(file(one(cap, 'claude-code'), '.claude/commands/review.md')).toBe(
      cap.files[0]!.content.toString(),
    )
    const toml = file(one(cap, 'gemini-cli'), '.gemini/commands/review.toml')
    expect(toml).toContain('description = "Review the given files for correctness"')
    expect(toml).toContain("prompt = '''\n\nReview {{args}} for correctness bugs.")
    expect(toml).not.toContain('$ARGUMENTS')
  })

  it('refuses $ARGUMENTS where no placeholder is documented', async () => {
    const cap = await input(FIXTURES.command!)
    for (const agent of [
      'cursor',
      'github-copilot',
      'roo-code',
      'kilo-code',
      'continue',
      'junie',
    ] as const)
      expect(one(cap, agent).status, agent).toBe('unsupported')
    for (const agent of ['opencode', 'augment', 'factory-droid', 'qwen-code'] as const)
      expect(one(cap, agent).status, agent).toBe('supported')
  })

  it('refuses positional placeholders and shell injection outside agents with the same meaning', async () => {
    const positional = await inline(FIXTURES.command!, { 'review.md': 'Compare $0 with $1.\n' })
    expect(one(positional, 'claude-code').status).toBe('supported')
    expect(one(positional, 'opencode')).toMatchObject({
      reason: expect.stringMatching(/positional/),
    })
    const shell = await inline(FIXTURES.command!, { 'review.md': 'Status: !`git status`\n' })
    expect(one(shell, 'opencode').status).toBe('supported')
    expect(one(shell, 'factory-droid')).toMatchObject({
      reason: expect.stringMatching(/shell commands/),
    })
  })

  it('never lets literal text become a Gemini shell or file injection', async () => {
    const cap = await inline(FIXTURES.command!, {
      'review.md': 'Explain !{rm -rf /} and @{secrets}.\n',
    })
    expect(one(cap, 'gemini-cli')).toMatchObject({
      status: 'unsupported',
      reason: expect.stringMatching(/interpret/),
    })
    expect(one(cap, 'qwen-code').status).toBe('unsupported')
  })

  it('writes plain markdown for Cursor and drops frontmatter it does not read', async () => {
    const cap = await inline(FIXTURES.command!, {
      'review.md': '---\ndescription: Lint\n---\nRun the linter.\n',
    })
    expect(file(one(cap, 'cursor'), '.cursor/commands/review.md')).toBe('Run the linter.\n')
    expect(one(cap, 'codex').status).toBe('unsupported')
  })
})

describe('subagents', () => {
  it('translates name, description and prompt, dropping model ids other agents do not share', async () => {
    const cap = await input(FIXTURES.subagent!)
    expect(file(one(cap, 'claude-code'), '.claude/agents/reviewer.md')).toBe(
      cap.files[0]!.content.toString(),
    )
    const oc = file(one(cap, 'opencode'), '.opencode/agents/reviewer.md')
    expect(frontmatter(oc)).toEqual({
      description: 'Reviews code changes for correctness. Use after a change is made.',
      mode: 'subagent',
    })
    expect(supported(one(cap, 'opencode')).notes.join()).toMatch(/model/)
    const toml = file(one(cap, 'codex'), '.codex/agents/reviewer.toml')
    expect(toml).toContain('name = "reviewer"')
    expect(toml).toContain(
      'developer_instructions = "You are a careful reviewer. Read the diff and report correctness bugs only."',
    )
    expect(file(one(cap, 'factory-droid'), '.factory/droids/reviewer.md')).toContain(
      'model: inherit',
    )
  })

  it('never widens a tools restriction', async () => {
    const cap = await inline(FIXTURES.subagent!, {
      'reviewer.md':
        '---\nname: reviewer\ndescription: Read-only reviewer for diffs.\ntools: Read, Grep, mcp__x__y\n---\nReview.\n',
    })
    for (const agent of ['cursor', 'codex', 'gemini-cli', 'opencode', 'goose'] as const)
      expect(one(cap, agent)).toMatchObject({
        status: 'unsupported',
        reason: expect.stringMatching(/restriction/),
      })
    const copilot = one(cap, 'github-copilot')
    expect(frontmatter(file(copilot, '.github/agents/reviewer.agent.md')).tools).toEqual([
      'Read',
      'Grep',
      'mcp__x__y',
    ])
    expect(supported(copilot).notes.join()).toMatch(/ignores the tools mcp__x__y/)
  })
})

describe('hooks', () => {
  it('merges Claude Code hooks into settings.json with the scripts under .claude/hooks', async () => {
    const cap = await input(FIXTURES.hook!)
    const { ops } = supported(one(cap, 'claude-code'))
    expect(ops).toContainEqual({
      kind: 'json',
      path: '.claude/settings.json',
      op: 'append',
      pointer: ['hooks', 'PreToolUse'],
      value: {
        matcher: 'Bash',
        hooks: [
          {
            type: 'command',
            command: 'node "${CLAUDE_PROJECT_DIR}/.claude/hooks/guard/scripts/guard.mjs"',
            timeout: 10,
          },
        ],
      },
    })
    expect(ops.find((o) => o.path === '.claude/hooks/guard/scripts/guard.mjs')).toMatchObject({
      mode: 0o644,
    })
    expect(ops.some((o) => o.path.endsWith('hook.json'))).toBe(false)
  })

  it('shares the Claude Code config with Cursor, which runs it natively', async () => {
    const c = compile(await input(FIXTURES.hook!), ['claude-code', 'cursor'])
    expect(c.ops.every((o) => o.agents.join() === 'claude-code,cursor')).toBe(true)
  })

  it('writes Copilot hooks with PascalCase events, which select the Claude-compatible payload', async () => {
    const r = one(await input(FIXTURES.hook!), 'github-copilot')
    expect(JSON.parse(file(r, '.github/hooks/guard.json'))).toEqual({
      version: 1,
      hooks: {
        PreToolUse: [
          {
            type: 'command',
            bash: 'node ./.github/hooks/guard/scripts/guard.mjs',
            cwd: '.',
            timeoutSec: 10,
            matcher: 'Bash',
          },
        ],
      },
    })
  })

  it('anchors Codex matchers and refuses tools whose payload differs', async () => {
    const { ops } = supported(one(await input(FIXTURES.hook!), 'codex'))
    expect(ops.find((o) => o.kind === 'json')).toMatchObject({
      path: '.codex/hooks.json',
      value: {
        matcher: '^(?:Bash)$',
        hooks: [
          {
            command: 'node "$(git rev-parse --show-toplevel)/.codex/hooks/guard/scripts/guard.mjs"',
          },
        ],
      },
    })
    const edit = await inline(FIXTURES.hook!, {
      'hook.json': JSON.stringify({
        hooks: {
          PostToolUse: [
            { matcher: 'Edit|Write', hooks: [{ type: 'command', command: './scripts/guard.mjs' }] },
          ],
        },
      }),
      'scripts/guard.mjs': '',
    })
    expect(one(edit, 'codex')).toMatchObject({
      status: 'unsupported',
      reason: expect.stringMatching(/Bash and mcp__/),
    })
    expect(one(await input(FIXTURES.hook!), 'gemini-cli').status).toBe('unsupported')
  })

  it('marks a script run directly as executable and refuses references outside the payload', async () => {
    const direct = await inline(FIXTURES.hook!, {
      'hook.json': JSON.stringify({
        hooks: { Stop: [{ hooks: [{ type: 'command', command: './scripts/guard.mjs --quiet' }] }] },
      }),
      'scripts/guard.mjs': '#!/usr/bin/env node\n',
    })
    expect(supported(one(direct, 'claude-code')).ops.find((o) => o.kind === 'file')).toMatchObject({
      mode: 0o755,
    })
    const outside = await inline(FIXTURES.hook!, {
      'hook.json': JSON.stringify({
        hooks: { Stop: [{ hooks: [{ type: 'command', command: 'sh ./../../evil.sh' }] }] },
      }),
    })
    expect(one(outside, 'claude-code')).toMatchObject({
      status: 'unsupported',
      reason: expect.stringMatching(/not a file in the payload/),
    })
  })
})

describe('mcp servers', () => {
  const entry = (r: AdapterResult, path: string) => supported(r).ops.find((o) => o.path === path)

  it('pins the package and references secrets by name, in each agent own syntax', async () => {
    const cap = await input(FIXTURES['mcp-server']!)
    expect(entry(one(cap, 'claude-code'), '.mcp.json')).toEqual({
      kind: 'json',
      path: '.mcp.json',
      op: 'set',
      pointer: ['mcpServers', 'files'],
      value: {
        command: 'npx',
        args: ['-y', '@example/files-mcp@1.2.3', '--root', '.'],
        env: { FILES_TOKEN: '${FILES_TOKEN}' },
      },
    })
    expect(entry(one(cap, 'cursor'), '.cursor/mcp.json')).toMatchObject({
      value: { env: { FILES_TOKEN: '${env:FILES_TOKEN}' } },
    })
    expect(entry(one(cap, 'opencode'), 'opencode.json')).toMatchObject({
      pointer: ['mcp', 'files'],
      value: {
        type: 'local',
        command: ['npx', '-y', '@example/files-mcp@1.2.3', '--root', '.'],
        environment: { FILES_TOKEN: '{env:FILES_TOKEN}' },
      },
    })
    expect(entry(one(cap, 'amp'), '.amp/settings.json')).toMatchObject({
      pointer: ['amp.mcpServers', 'files'],
    })
    expect(supported(one(cap, 'claude-code')).notes.join()).toMatch(
      /not part of the sealed payload/,
    )
  })

  it('writes both Copilot surfaces and a TOML table for Codex', async () => {
    const cap = await input(FIXTURES['mcp-server']!)
    const copilot = supported(one(cap, 'github-copilot')).ops
    expect(copilot.map((o) => o.path)).toEqual(['.vscode/mcp.json', '.github/mcp.json'])
    expect(copilot[0]).toMatchObject({
      pointer: ['servers', 'files'],
      value: { type: 'stdio', env: { FILES_TOKEN: '${env:FILES_TOKEN}' } },
    })
    expect(copilot[1]).toMatchObject({ value: { type: 'local', tools: ['*'] } })
    expect(supported(one(cap, 'codex')).ops[0]).toEqual({
      kind: 'block',
      path: '.codex/config.toml',
      syntax: 'toml',
      id: 'demo/files',
      content:
        '[mcp_servers.files]\ncommand = "npx"\nargs = ["-y", "@example/files-mcp@1.2.3", "--root", "."]\nenv_vars = ["FILES_TOKEN"]',
    })
  })

  it('refuses agents that cannot reference an environment variable for a required secret', async () => {
    const cap = await input(FIXTURES['mcp-server']!)
    for (const agent of ['zed', 'junie', 'warp', 'trae'] as const)
      expect(one(cap, agent)).toMatchObject({
        status: 'unsupported',
        reason: expect.stringMatching(/FILES_TOKEN/),
      })
  })

  it('installs remote servers and refuses unpinned or unfillable ones', async () => {
    const server = (body: object) =>
      inline(FIXTURES['mcp-server']!, {
        'server.json': JSON.stringify({
          name: 'io.example/x',
          description: 'd',
          version: '1',
          ...body,
        }),
      })
    const remote = await server({
      remotes: [{ type: 'streamable-http', url: 'https://mcp.example.com/mcp' }],
    })
    expect(entry(one(remote, 'claude-code'), '.mcp.json')).toMatchObject({
      value: { type: 'http', url: 'https://mcp.example.com/mcp' },
    })
    expect(entry(one(remote, 'gemini-cli'), '.gemini/settings.json')).toMatchObject({
      value: { httpUrl: 'https://mcp.example.com/mcp' },
    })
    expect(entry(one(remote, 'zed'), '.zed/settings.json')).toMatchObject({
      value: { url: 'https://mcp.example.com/mcp' },
    })
    expect(JSON.parse(file(one(remote, 'continue'), '.continue/mcpServers/files.json'))).toEqual({
      mcpServers: { files: { url: 'https://mcp.example.com/mcp' } },
    })
    const unpinned = await server({
      packages: [{ registryType: 'npm', identifier: 'x', transport: { type: 'stdio' } }],
    })
    expect(one(unpinned, 'claude-code')).toMatchObject({
      reason: expect.stringMatching(/not pinned/),
    })
    const header = await server({
      remotes: [
        { type: 'sse', url: 'https://x.dev/sse', headers: [{ name: 'X-Key', isRequired: true }] },
      ],
    })
    expect(one(header, 'claude-code')).toMatchObject({ reason: expect.stringMatching(/X-Key/) })
  })
})

describe('policies', () => {
  it('installs deny and ask rules, never allow rules', async () => {
    const cap = await input(FIXTURES.policy!)
    const values = supported(one(cap, 'claude-code')).ops.map((o) =>
      o.kind === 'json' ? `${o.pointer[1]} ${o.value}` : '',
    )
    expect(values).toEqual([
      'deny Read(/.env)',
      'deny Read(/.env.*)',
      'deny Bash(rm -rf)',
      'deny Bash(rm -rf *)',
      'ask Bash(git push)',
      'ask Bash(git push *)',
    ])
    const allow = await inline(FIXTURES.policy!, { 'policy.json': '{"allow":{"shell":["curl"]}}' })
    expect(one(allow, 'claude-code')).toMatchObject({
      status: 'unsupported',
      reason: expect.stringMatching(/cannot allow/),
    })
  })

  it('translates command prefixes to Codex rules and refuses what an agent cannot express', async () => {
    const cap = await input(FIXTURES.policy!)
    expect(one(cap, 'codex')).toMatchObject({
      status: 'unsupported',
      reason: expect.stringMatching(/file reads/),
    })
    const shellOnly = await inline(FIXTURES.policy!, {
      'policy.json': '{"deny":{"shell":["rm -rf"]},"ask":{"shell":["git push"]}}',
    })
    expect(file(one(shellOnly, 'codex'), '.codex/rules/no-secrets.rules')).toBe(
      'prefix_rule(pattern=["rm", "-rf"], decision="forbidden", justification="Installed by Sigil from demo/no-secrets")\n' +
        'prefix_rule(pattern=["git", "push"], decision="prompt", justification="Installed by Sigil from demo/no-secrets")\n',
    )
    expect(one(shellOnly, 'cursor')).toMatchObject({
      status: 'unsupported',
      reason: expect.stringMatching(/allow and deny/),
    })
    expect(supported(one(shellOnly, 'opencode')).ops).toHaveLength(4)
  })
})

describe('plugins', () => {
  it('installs a Claude Code plugin as a plugin directory and refuses other agents', async () => {
    const cap = await input(FIXTURES.plugin!)
    expect(supported(one(cap, 'claude-code')).ops.map((o) => o.path)).toEqual([
      '.claude/skills/pack/.claude-plugin/plugin.json',
      '.claude/skills/pack/skills/pack-skill/SKILL.md',
    ])
    expect(one(cap, 'gemini-cli').status).toBe('unsupported')
  })
})

describe('agents with a product status', () => {
  it('warns on every install for discontinued agents', async () => {
    const r = one(await input(FIXTURES['agent-skill']!), 'roo-code')
    expect(supported(r).notes.join()).toMatch(/shut down on 2026-05-15/)
  })

  it('lists every agent in AGENTS in the compile result order', async () => {
    const c = compile(await input(FIXTURES['agent-skill']!), [...AGENTS].reverse())
    expect(c.results.map((r) => r.agent)).toEqual([...AGENTS])
  })
})
