import { type Adapter, fileOp, type KnownGap, no, ok, slugOf, warn } from '../types.js'

/**
 * A `plugin` payload is one agent's native pack (a Claude Code plugin, a Gemini CLI extension...).
 * It is installed only into the agent that defines the format, and only where that agent documents
 * a project-level install made of plain files.
 */
export const CLAUDE_PLUGIN_MANIFEST = '.claude-plugin/plugin.json'

export const pluginAdapters: Adapter[] = [
  {
    format: 'plugin',
    agent: 'claude-code',
    target: '.claude/skills/<slug>/ (plugin directory)',
    sources: [
      'https://code.claude.com/docs/en/plugins/loading',
      'https://code.claude.com/docs/en/plugins-reference',
    ],
    compile(cap) {
      if (!cap.files.some((f) => f.path === CLAUDE_PLUGIN_MANIFEST))
        return no(`This pack is not a Claude Code plugin (no ${CLAUDE_PLUGIN_MANIFEST}).`)
      const dir = `.claude/skills/${slugOf(cap)}`
      return ok(
        cap.files.map((f) => fileOp(`${dir}/${f.path}`, f.content)),
        [
          warn(
            'Claude Code loads a plugin directory under .claude/skills/ only after you trust the project.',
          ),
        ],
      )
    },
  },
]

const pack = (agent: KnownGap['agent'], reason: string, sources: string[]): KnownGap => ({
  format: 'plugin',
  agent,
  reason,
  sources,
})

export const pluginGaps: KnownGap[] = [
  pack('gemini-cli', 'Gemini CLI loads extensions only from ~/.gemini/extensions (user level).', [
    'https://geminicli.com/docs/extensions/reference/',
  ]),
  pack(
    'codex',
    'Codex installs plugins into ~/.codex/plugins; a repository marketplace only makes them discoverable.',
    ['https://developers.openai.com/codex/plugins/build'],
  ),
  pack(
    'cursor',
    'Cursor installs plugins from its UI; a file-only project install is not documented.',
    ['https://cursor.com/docs/plugins'],
  ),
  pack(
    'github-copilot',
    'Copilot enables repository plugins through a marketplace in .github/copilot/settings.json, which Sigil does not generate yet.',
    ['https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference'],
  ),
  pack('opencode', 'OpenCode plugins are JavaScript modules, not packs of agent files.', [
    'https://opencode.ai/docs/plugins/',
  ]),
  pack(
    'goose',
    'Goose plugins use their own manifest (plugin.json or .goose-plugin/plugin.json), not the Claude Code plugin format.',
    ['https://goose-docs.ai/docs/guides/context-engineering/plugins'],
  ),
  pack('qwen-code', 'Qwen Code installs extensions into ~/.qwen/extensions (user level).', [
    'https://qwenlm.github.io/qwen-code-docs/en/users/extension/introduction/',
  ]),
]
