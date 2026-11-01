import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CLAUDE_DISALLOWED_TOOLS, claudeCode } from '../../src/lab/agents/claude-code.js'
import { parseClaudeStream } from '../../src/lab/agents/claude-stream.js'
import { driverFor } from '../../src/lab/agents/registry.js'
import { parseStubStream, stubDriver } from '../../src/lab/agents/stub.js'
import type { StampedLine } from '../../src/lab/agents/types.js'
import { AuthError, readToken, resolveAuth } from '../../src/lab/auth.js'
import { resolveCapability } from '../../src/lab/capability.js'

const fx = (p: string) => join(import.meta.dirname, '..', 'fixtures', 'lab', p)
const stamped = (file: string): StampedLine[] =>
  readFileSync(fx(`streams/${file}`), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line, i) => ({ t: i * 100, line }))

// Recorded from a real `claude -p` run (Claude Code 2.1.316, Haiku) on tasks/_sample, treatment.
const RUN =
  '/private/var/folders/hm/gm1lz52d5pz_0v0hpxdxp5n80000gn/T/sigil-slugify-unicode-treatment-1-HARs7Y'

describe('Claude Code stream parser (real output)', () => {
  const out = parseClaudeStream(stamped('claude-code-2.1.316-treatment.jsonl'))

  it('reads model, version, tokens and cost from the stream', () => {
    expect(out.model).toBe('claude-haiku-5-5')
    expect(out.version).toBe('2.1.316')
    expect(out.tokens).toBe(12 + 3168 + 24738 + 110475)
    expect(out.costUsd).toBeCloseTo(0.0076375, 6)
    expect(out.finalMessage).toMatch(/^`slugify\('Crème Brûlée -- 2 Ways!'\)` now returns/)
    expect(out.error).toBeUndefined()
  })

  it('maps tool calls and results, with tool names on results', () => {
    const calls = out.events.filter((e) => e.kind === 'tool-call')
    expect(calls.map((e) => e.tool).sort()).toEqual([
      'Bash',
      'Bash',
      'Bash',
      'Bash',
      'Edit',
      'Read',
      'Read',
      'Write',
    ])
    const results = out.events.filter((e) => e.kind === 'tool-result')
    expect(results.length).toBe(calls.length)
    expect(results.every((e) => e.tool && e.tool !== 'tool')).toBe(true)
    expect(calls.find((e) => e.tool === 'Bash')?.text).toMatch(/^\$ /)
    expect(out.events.some((e) => e.kind === 'system' && e.text.includes('thinking'))).toBe(false)
  })

  it('reports the session environment used to verify isolation', () => {
    expect(out.environment?.skills).toContain('unicode-slugs')
    expect(out.environment?.mcpServers).toEqual([])
    expect(out.environment?.plugins.every((p) => p.path === 'builtin')).toBe(true)
    const ctx = { homeDir: `${RUN}/home`, workDir: `${RUN}/project`, installed: ['unicode-slugs'] }
    expect(claudeCode.isolationProblems(out, { ...ctx, condition: 'treatment' })).toEqual([])
    expect(claudeCode.isolationProblems(out, { ...ctx, condition: 'baseline' })).toEqual([
      'skill "unicode-slugs" is visible in the baseline',
    ])
    expect(
      claudeCode.isolationProblems(out, {
        ...ctx,
        homeDir: '/Users/someone',
        condition: 'treatment',
      })[0],
    ).toMatch(/^memory path outside the isolated home/)
  })

  it('flags foreign plugins, MCP servers and a missing skill', () => {
    const env = {
      ...out.environment!,
      mcpServers: ['github'],
      plugins: [{ name: 'mine', path: '/Users/x/.claude/plugins/mine' }],
      skills: [],
    }
    const problems = claudeCode.isolationProblems(
      { ...out, environment: env },
      {
        homeDir: `${RUN}/home`,
        workDir: `${RUN}/project`,
        installed: ['unicode-slugs'],
        condition: 'treatment',
      },
    )
    expect(problems).toEqual([
      'MCP servers loaded: github',
      'non-builtin plugins loaded: mine',
      'installed skill "unicode-slugs" was not loaded',
    ])
  })

  it('treats an auth failure as an agent error, not a task failure', () => {
    const failed = parseClaudeStream(stamped('claude-code-2.1.316-not-logged-in.jsonl'))
    expect(failed.error).toBe('Not logged in · Please run /login')
    expect(parseClaudeStream([{ t: 0, line: 'not json' }], 'boom').error).toBe(
      'no result event: boom',
    )
  })
})

describe('Claude Code driver', () => {
  const spec = {
    prompt: 'Fix it.',
    model: 'haiku',
    workDir: '/w',
    homeDir: '/h',
    token: 'sk-ant-oat01-secretsecret',
  }

  it('keeps the token out of argv and passes the prompt on stdin', () => {
    const inv = claudeCode.invocation({ ...spec, runner: 'docker' })
    expect(inv.argv.join(' ')).not.toContain('secretsecret')
    expect(inv.secretEnv).toEqual({ CLAUDE_CODE_OAUTH_TOKEN: spec.token })
    expect(inv.stdin).toBe('Fix it.')
    expect(inv.env.HOME).toBe('/h')
    expect(inv.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC).toBe('1')
    expect(inv.argv).toEqual(
      expect.arrayContaining([
        '-p',
        '--model',
        'haiku',
        '--strict-mcp-config',
        '--no-session-persistence',
      ]),
    )
    expect(inv.argv[inv.argv.indexOf('--disallowedTools') + 1]).toBe(
      CLAUDE_DISALLOWED_TOOLS.join(','),
    )
    expect(inv.argv[inv.argv.indexOf('--permission-mode') + 1]).toBe('bypassPermissions')
    expect(inv.argv).not.toContain('--settings')
  })

  it('sandboxes Bash on the host and caps spend when asked', () => {
    const inv = claudeCode.invocation({
      ...spec,
      runner: 'host',
      operatorHome: '/Users/x',
      maxBudgetUsd: 0.5,
    })
    const settings = JSON.parse(inv.argv[inv.argv.indexOf('--settings') + 1]!) as {
      sandbox: { enabled: boolean }
    }
    expect(settings.sandbox.enabled).toBe(true)
    expect(inv.argv[inv.argv.indexOf('--max-budget-usd') + 1]).toBe('0.5')
  })

  it('pins the agent version in the image and refuses floating ones', () => {
    expect(claudeCode.dockerLayers('2.1.316')).toEqual([
      'RUN npm install -g @anthropic-ai/claude-code@2.1.316 && npm cache clean --force',
    ])
    expect(() => claudeCode.dockerLayers('latest')).toThrow(/invalid Claude Code version/)
    expect(claudeCode.parseVersion('2.1.316 (Claude Code)\n')).toBe('2.1.316')
  })

  it('installs an agent-skill payload under .claude/skills/<slug>/', async () => {
    const cap = await resolveCapability(fx('catalog/skills/sample/unicode-slugs'), process.cwd())
    const files = await claudeCode.installFiles(cap, mkdtempSync(join(tmpdir(), 'sigil-repo-')))
    expect(files.map((f) => f.path)).toEqual(['.claude/skills/unicode-slugs/SKILL.md'])
    expect(claudeCode.installedNames(cap)).toEqual(['unicode-slugs'])
  })

  it('is the only registered driver; the stub is never one', () => {
    expect(driverFor('claude-code')).toBe(claudeCode)
    expect(driverFor('codex')).toBeUndefined()
    expect(driverFor('toString')).toBeUndefined()
  })
})

describe('stub agent', () => {
  it('parses its own event stream', () => {
    const lines = [
      '{"type":"init","cwd":"/w","home":"/h","uid":10001}',
      '{"type":"event","kind":"tool-call","tool":"Bash","text":"$ ls","input":{"command":"ls"}}',
      '{"type":"event","kind":"tool-result","tool":"Bash","text":"a","ok":true}',
      '{"type":"result","result":"Done."}',
    ].map((line, t) => ({ t, line }))
    const out = parseStubStream(lines)
    expect(out.finalMessage).toBe('Done.')
    expect(out.events.map((e) => e.kind)).toEqual(['system', 'tool-call', 'tool-result'])
    expect(
      stubDriver({ steps: [] }).isolationProblems(out, {
        condition: 'baseline',
        homeDir: '/h',
        workDir: '/w',
        installed: [],
      }),
    ).toEqual([])
    expect(parseStubStream([]).error).toBe('stub agent produced no result')
  })
})

describe('auth', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sigil-auth-'))
  const file = join(dir, 'token')

  it('prefers the environment, then a private auth file', async () => {
    expect(
      await readToken({ env: { CLAUDE_CODE_OAUTH_TOKEN: ' tok-from-env ' }, authFile: file }),
    ).toEqual({
      token: 'tok-from-env',
      source: '$CLAUDE_CODE_OAUTH_TOKEN',
    })
    writeFileSync(file, 'tok-from-file\n')
    chmodSync(file, 0o600)
    expect((await readToken({ env: {}, authFile: file }))?.token).toBe('tok-from-file')
  })

  it('refuses an auth file other users can read', async () => {
    chmodSync(file, 0o644)
    await expect(readToken({ env: {}, authFile: file })).rejects.toThrow(/chmod 600/)
    chmodSync(file, 0o600)
  })

  it('needs a token for Docker, falls back to the keychain only on a macOS host', async () => {
    await expect(readToken({ env: {}, authFile: join(dir, 'missing') })).rejects.toThrow(AuthError)
    const none = { env: {} as NodeJS.ProcessEnv, defaultFile: join(dir, 'missing') }
    expect(await readToken(none)).toBeUndefined()
    await expect(resolveAuth({ runner: 'docker', ...none, platform: 'darwin' })).rejects.toThrow(
      /claude setup-token/,
    )
    await expect(resolveAuth({ runner: 'host', ...none, platform: 'darwin' })).resolves.toEqual({
      kind: 'keychain',
    })
    await expect(resolveAuth({ runner: 'host', ...none, platform: 'linux' })).rejects.toThrow(
      AuthError,
    )
  })
})
