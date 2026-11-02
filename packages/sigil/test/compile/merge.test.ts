import { describe, expect, it } from 'vitest'
import {
  appendBlock,
  applyAppend,
  applySet,
  blockStatus,
  MergeError,
  mergeStatus,
  parseJsonDoc,
  pruneContainers,
  removeBlock,
  revert,
  serializeJson,
  tomlConflicts,
} from '../../src/compile/merge.js'
import { tomlString } from '../../src/compile/text.js'
import { safeRelative } from '../../src/compile/workspace.js'

const settings = `{
    "model": "opus",
    "hooks": {
        "Stop": [
            { "hooks": [{ "type": "command", "command": "say done" }] }
        ]
    }
}
`

describe('json merge', () => {
  it('round-trips a set and an append back to the original value', () => {
    const doc = parseJsonDoc(
      Buffer.from(`${JSON.stringify(JSON.parse(settings), null, 4)}\n`),
      's.json',
    )
    expect(doc.indent).toBe('    ')
    const original = serializeJson(doc).toString()
    const hook = { matcher: 'Bash', hooks: [{ type: 'command', command: 'guard' }] }
    const a = applyAppend(doc, ['hooks', 'PreToolUse'], hook, 's.json')
    const b = applySet(doc, ['mcpServers', 'files'], { command: 'npx' }, 's.json')
    expect(a.createdContainers).toEqual([['hooks', 'PreToolUse']])
    expect(b.createdContainers).toEqual([['mcpServers']])
    expect(mergeStatus(doc, 'append', ['hooks', 'PreToolUse'], hook)).toBe('ok')

    expect(revert(doc, 'set', ['mcpServers', 'files'], { command: 'npx' }, false)).toBe('removed')
    expect(revert(doc, 'append', ['hooks', 'PreToolUse'], hook, false)).toBe('removed')
    pruneContainers(doc, [...a.createdContainers, ...b.createdContainers])
    expect(serializeJson(doc).toString()).toBe(original)
  })

  it('never replaces a value it did not write', () => {
    const doc = parseJsonDoc(
      Buffer.from('{"mcpServers":{"files":{"command":"mine"}}}'),
      '.mcp.json',
    )
    expect(() => applySet(doc, ['mcpServers', 'files'], { command: 'npx' }, '.mcp.json')).toThrow(
      /will not replace/,
    )
    expect(applySet(doc, ['mcpServers', 'files'], { command: 'mine' }, '.mcp.json').adopted).toBe(
      true,
    )
    expect(() =>
      applyAppend(
        parseJsonDoc(Buffer.from('{"hooks":{"Stop":{}}}'), 'x'),
        ['hooks', 'Stop'],
        1,
        'x',
      ),
    ).toThrow(/not an array/)
  })

  it('reports and, only with force, removes a value the user changed', () => {
    const doc = parseJsonDoc(Buffer.from('{"mcpServers":{"files":{"command":"edited"}}}'), 'x')
    expect(mergeStatus(doc, 'set', ['mcpServers', 'files'], { command: 'npx' })).toBe('modified')
    expect(revert(doc, 'set', ['mcpServers', 'files'], { command: 'npx' }, false)).toBe('modified')
    expect(revert(doc, 'set', ['mcpServers', 'files'], { command: 'npx' }, true)).toBe('removed')
    expect(pruneContainers(doc, [['mcpServers']])).toEqual([])
    expect(doc.value).toEqual({})
  })

  it('refuses JSON with comments instead of dropping them', () => {
    expect(() =>
      parseJsonDoc(Buffer.from('{\n  // mine\n  "a": 1\n}\n'), '.vscode/mcp.json'),
    ).toThrow(MergeError)
    expect(() => parseJsonDoc(Buffer.from('[1]'), 'x')).toThrow(/object/)
    expect(parseJsonDoc(Buffer.from('{"a":1}'), 'x').reformatted).toBe(true)
  })
})

describe('json merge refuses prototype keys', () => {
  const polluted = () => ({}) as Record<string, unknown>

  for (const pointer of [
    ['__proto__', 'polluted'],
    ['mcpServers', '__proto__'],
    ['hooks', 'constructor', 'prototype'],
  ]) {
    it(`never writes through ${pointer.join('.')}`, () => {
      const doc = parseJsonDoc(Buffer.from(settings), 's.json')
      expect(() => applySet(doc, pointer, { command: 'x' }, 's.json')).toThrow(MergeError)
      expect(() => applyAppend(doc, pointer, 'x', 's.json')).toThrow(MergeError)
      expect(polluted().polluted).toBeUndefined()
      expect(polluted().command).toBeUndefined()
      expect(serializeJson(doc).toString()).toBe(
        serializeJson(parseJsonDoc(Buffer.from(settings), 's.json')).toString(),
      )
    })
  }

  it('treats a recorded prototype pointer as missing instead of deleting through it', () => {
    const doc = parseJsonDoc(Buffer.from(settings), 's.json')
    expect(revert(doc, 'set', ['__proto__', 'toString'], null, true)).toBe('missing')
    expect(revert(doc, 'set', ['hooks', 'constructor'], null, true)).toBe('missing')
    expect(pruneContainers(doc, [['__proto__'], ['hooks', 'constructor']])).toEqual([])
    expect(mergeStatus(doc, 'set', ['__proto__', 'toString'], null)).toBe('missing')
    expect(typeof Object.prototype.toString).toBe('function')
  })

  it('may still use a key that only exists on Object.prototype as a name', () => {
    const doc = parseJsonDoc(undefined, 's.json')
    applySet(doc, ['mcpServers', 'toString'], { command: 'npx' }, 's.json')
    expect(JSON.parse(serializeJson(doc).toString())).toEqual({
      mcpServers: { toString: { command: 'npx' } },
    })
  })
})

describe('text blocks', () => {
  it('trims trailing newlines in linear time', () => {
    const content = `${'\n'.repeat(200_000)}body${'\n'.repeat(3)}`
    const t0 = performance.now()
    const { inserted } = appendBlock(undefined, 'markdown', 'demo/x', content)
    expect(performance.now() - t0).toBeLessThan(500)
    expect(inserted.endsWith('body\n<!-- sigil:end demo/x -->\n')).toBe(true)
  })

  for (const [label, base] of [
    ['an empty file', undefined],
    ['a file ending in a newline', '# Project\n\nUse pnpm.\n'],
    ['a file without a final newline', '# Project'],
    ['a file ending in a blank line', '# Project\n\n'],
  ] as const) {
    it(`restores ${label} byte for byte`, () => {
      const { text, inserted } = appendBlock(base, 'markdown', 'demo/x', 'Rule body.\n')
      expect(text).toContain('<!-- sigil:begin demo/x -->\nRule body.\n<!-- sigil:end demo/x -->\n')
      expect(blockStatus(text, 'markdown', 'demo/x', inserted)).toBe('ok')
      expect(removeBlock(text, 'markdown', 'demo/x', inserted, false)).toEqual({
        text: base ?? '',
        status: 'removed',
      })
    })
  }

  it('detects an edited block and removes it only with force', () => {
    const { text, inserted } = appendBlock('# P\n', 'markdown', 'demo/x', 'Body')
    const edited = text.replace('Body', 'Edited body')
    expect(blockStatus(edited, 'markdown', 'demo/x', inserted)).toBe('modified')
    expect(removeBlock(edited, 'markdown', 'demo/x', inserted, false).status).toBe('modified')
    expect(removeBlock(edited, 'markdown', 'demo/x', inserted, true).text).toBe('# P\n\n')
  })

  it('finds TOML tables that already exist, so the file never gets a duplicate table', () => {
    const existing = 'model = "o3"\n\n[mcp_servers."files"]\ncommand = "x"\n'
    expect(tomlConflicts(existing, '[mcp_servers.files]\ncommand = "npx"')).toEqual([
      'mcp_servers.files',
    ])
    expect(tomlConflicts(existing, '[mcp_servers.other]')).toEqual([])
  })
})

describe('toml strings and paths', () => {
  it('escapes what TOML basic strings cannot hold and keeps prompts readable', () => {
    expect(tomlString('say "hi"\\now')).toBe('"say \\"hi\\"\\\\now"')
    expect(tomlString("line one\nline 'two'\n")).toBe("'''\nline one\nline 'two'\n'''")
    expect(tomlString("has ''' inside\n")).toBe("\"has ''' inside\\n\"")
  })

  it('refuses paths that leave the project', () => {
    for (const bad of ['../x', '/etc/passwd', 'a/../../b', 'C:/x', 'a\\b', ''])
      expect(() => safeRelative(bad), bad).toThrow()
    expect(safeRelative('a/./b/')).toBe('a/b')
  })
})
