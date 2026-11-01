import type { AgentId } from '../core/ids.js'

/** The date every mapping in this module was last checked against the agent's official docs. */
export const DOCS_CHECKED = '2026-11-01'

export interface AgentInfo {
  name: string
  /** Paths (relative to the project root) whose presence means the project uses this agent. */
  markers: readonly string[]
  /** Product status worth a warning on every install, e.g. a discontinued agent. */
  status?: string
}

export const AGENT_INFO: Record<AgentId, AgentInfo> = {
  'claude-code': {
    name: 'Claude Code',
    markers: ['.claude', 'CLAUDE.md', 'CLAUDE.local.md', '.mcp.json'],
  },
  codex: { name: 'OpenAI Codex', markers: ['.codex'] },
  cursor: { name: 'Cursor', markers: ['.cursor', '.cursorrules'] },
  'github-copilot': {
    name: 'GitHub Copilot',
    markers: [
      '.github/copilot-instructions.md',
      '.github/instructions',
      '.github/prompts',
      '.github/agents',
      '.github/skills',
      '.github/hooks',
      '.github/copilot',
      '.github/mcp.json',
      '.vscode/mcp.json',
    ],
  },
  'gemini-cli': {
    name: 'Gemini CLI',
    markers: ['.gemini', 'GEMINI.md'],
    status:
      'Google replaced Gemini CLI with Antigravity CLI for unpaid and Google One users on 2026-06-18.',
  },
  opencode: { name: 'OpenCode', markers: ['.opencode', 'opencode.json', 'opencode.jsonc'] },
  windsurf: {
    name: 'Windsurf (Devin Desktop)',
    markers: ['.windsurf', '.windsurfrules', '.devin'],
    status:
      'Windsurf became Devin Desktop on 2026-06-02 and its Cascade agent was removed on 2026-09-08; Devin Desktop still imports .windsurf/ rules and skills.',
  },
  cline: { name: 'Cline', markers: ['.cline', '.clinerules'] },
  'roo-code': {
    name: 'Roo Code',
    markers: ['.roo', '.roomodes', '.roorules'],
    status: 'Roo Code was shut down on 2026-05-15 and its repository is archived.',
  },
  'kilo-code': {
    name: 'Kilo Code',
    markers: ['.kilo', '.kilocode', 'kilo.json', 'kilo.jsonc', '.kilocodemodes'],
  },
  amp: { name: 'Amp', markers: ['.amp'] },
  aider: {
    name: 'Aider',
    markers: ['.aider.conf.yml', '.aider.conf.yaml', '.aider.chat.history.md'],
  },
  zed: { name: 'Zed', markers: ['.zed', '.rules'] },
  junie: { name: 'JetBrains Junie', markers: ['.junie'] },
  kiro: { name: 'Kiro', markers: ['.kiro'] },
  goose: { name: 'Goose', markers: ['.goosehints', '.goose'] },
  continue: {
    name: 'Continue',
    markers: ['.continue', '.continuerc.json'],
    status:
      'Continue is no longer maintained: its repository is read-only after a final 2.0.0 release.',
  },
  augment: { name: 'Augment Code', markers: ['.augment', '.augment-guidelines'] },
  'qwen-code': { name: 'Qwen Code', markers: ['.qwen', 'QWEN.md'] },
  'factory-droid': { name: 'Factory Droid', markers: ['.factory'] },
  trae: { name: 'Trae', markers: ['.trae'] },
  warp: { name: 'Warp', markers: ['.warp', 'WARP.md'] },
  generic: { name: 'Any AGENTS.md agent', markers: ['AGENTS.md', '.agents'] },
}
