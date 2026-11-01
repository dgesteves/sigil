import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { claudeCode } from '../../src/lab/agents/claude-code.js'
import { hostDenyRules, hostGuardCommand, hostSettings } from '../../src/lab/agents/claude-host.js'

const root = realpathSync(mkdtempSync(join(tmpdir(), 'sigil-guard-')))
const work = join(root, 'project')
mkdirSync(join(work, 'src'), { recursive: true })
symlinkSync(root, join(work, 'escape'))

/** Runs the hook exactly as Claude Code does: through sh, payload on stdin. */
function hook(toolInput: Record<string, unknown>, tool = 'Write') {
  const r = spawnSync('/bin/sh', ['-c', hostGuardCommand(work)], {
    input: JSON.stringify({
      hook_event_name: 'PreToolUse',
      cwd: work,
      tool_name: tool,
      tool_input: toolInput,
    }),
    encoding: 'utf8',
  })
  return { code: r.status, stderr: r.stderr }
}

describe('host guard hook', () => {
  it('allows edits inside the work dir', () => {
    expect(hook({ file_path: join(work, 'src', 'a.js') }).code).toBe(0)
    expect(hook({ file_path: 'src/new/b.js' }).code).toBe(0)
    expect(hook({ notebook_path: join(work, 'n.ipynb') }, 'NotebookEdit').code).toBe(0)
    expect(hook({ command: 'ls' }, 'Bash').code).toBe(0)
  })

  it('blocks edits outside it, including through a symlink or ..', () => {
    const outside = hook({ file_path: join(root, 'outside.txt') })
    expect(outside.code).toBe(2)
    expect(outside.stderr).toMatch(/^Blocked by the Sigil lab: Write may only change files inside /)
    expect(hook({ file_path: '../outside.txt' }).code).toBe(2)
    expect(hook({ file_path: join(work, 'escape', 'x.txt') }).code).toBe(2)
    expect(hook({ file_path: '/etc/hosts' }, 'Edit').code).toBe(2)
  })

  it('blocks when the payload is unreadable', () => {
    const r = spawnSync('/bin/sh', ['-c', hostGuardCommand(work)], {
      input: 'not json',
      encoding: 'utf8',
    })
    expect(r.status).toBe(2)
  })

  it('survives work dirs that need shell quoting', () => {
    const odd = join(root, "it's here")
    mkdirSync(odd)
    const out = execFileSync('/bin/sh', ['-c', `${hostGuardCommand(odd)}; echo exit=$?`], {
      input: JSON.stringify({
        cwd: odd,
        tool_name: 'Write',
        tool_input: { file_path: join(odd, 'a') },
      }),
      encoding: 'utf8',
    })
    expect(out.trim()).toBe('exit=0')
  })
})

describe('host settings', () => {
  it('deny credentials and the operator config under both homes, and Bash(security)', () => {
    const rules = hostDenyRules('/Users/someone')
    expect(rules).toContain('Bash(security:*)')
    for (const r of [
      'Read(~/Library/Keychains/**)',
      'Edit(~/Library/Keychains/**)',
      'Read(//Users/someone/Library/Keychains/**)',
      'Read(~/.ssh/**)',
      'Read(//Users/someone/.aws/**)',
      'Read(~/.config/gh/**)',
      'Read(~/.npmrc)',
      'Read(//Users/someone/.netrc)',
      'Read(//Users/someone/.claude/**)',
      'Read(//Users/someone/.claude.json)',
      'Edit(~/**)',
      'Edit(//Users/someone/**)',
    ]) {
      expect(rules).toContain(r)
    }
  })

  it('reach Claude Code as one --settings JSON with sandbox, deny rules and the hook', () => {
    const inv = claudeCode.invocation({
      prompt: 'x',
      model: 'haiku',
      workDir: work,
      homeDir: join(root, 'home'),
      runner: 'host',
      operatorHome: '/Users/someone',
    })
    const settings = JSON.parse(inv.argv[inv.argv.indexOf('--settings') + 1]!)
    expect(settings).toEqual(hostSettings(work, '/Users/someone'))
    expect(settings.sandbox.enabled).toBe(true)
    expect(settings.hooks.PreToolUse[0].matcher).toBe('Edit|Write|MultiEdit|NotebookEdit')
    expect(() =>
      claudeCode.invocation({
        prompt: 'x',
        model: 'm',
        workDir: work,
        homeDir: root,
        runner: 'host',
      }),
    ).toThrow(/whose home/)
  })
})
