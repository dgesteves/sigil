import type { AgentId } from '../../core/ids.js'
import { type Adapter, fileOp, type KnownGap, ok, slugOf } from '../types.js'

/**
 * Agent Skills are the one format every major agent reads natively, so the folder is copied
 * byte for byte. Agents differ only in where they look; `.agents/skills/` is the shared location,
 * and where an agent documents several locations the compiler reuses one another target already
 * writes, so a multi-agent install produces as few copies as possible.
 */
interface SkillTarget {
  agent: AgentId
  /** Documented project-level skill roots, preferred first. */
  dirs: readonly string[]
  sources: readonly string[]
}

const TARGETS: SkillTarget[] = [
  {
    agent: 'claude-code',
    dirs: ['.claude/skills'],
    sources: ['https://code.claude.com/docs/en/skills'],
  },
  {
    agent: 'codex',
    dirs: ['.agents/skills'],
    sources: ['https://learn.chatgpt.com/docs/build-skills'],
  },
  {
    agent: 'cursor',
    dirs: ['.agents/skills', '.cursor/skills', '.claude/skills'],
    sources: ['https://cursor.com/docs/skills'],
  },
  {
    agent: 'github-copilot',
    dirs: ['.agents/skills', '.github/skills', '.claude/skills'],
    sources: ['https://docs.github.com/en/copilot/concepts/agents/about-agent-skills'],
  },
  {
    agent: 'gemini-cli',
    dirs: ['.agents/skills', '.gemini/skills'],
    sources: ['https://geminicli.com/docs/cli/skills/'],
  },
  {
    agent: 'opencode',
    dirs: ['.agents/skills', '.opencode/skills', '.claude/skills'],
    sources: ['https://opencode.ai/docs/skills/'],
  },
  {
    agent: 'windsurf',
    dirs: ['.agents/skills', '.windsurf/skills'],
    sources: ['https://docs.devin.ai/desktop/cascade/skills'],
  },
  {
    agent: 'cline',
    dirs: ['.cline/skills', '.claude/skills'],
    sources: ['https://docs.cline.bot/customization/skills.md'],
  },
  {
    agent: 'roo-code',
    dirs: ['.agents/skills', '.roo/skills'],
    sources: ['https://roocodeinc.github.io/Roo-Code/features/skills'],
  },
  {
    agent: 'kilo-code',
    dirs: ['.agents/skills', '.kilo/skills'],
    sources: ['https://kilo.ai/docs/customize/skills'],
  },
  {
    agent: 'amp',
    dirs: ['.agents/skills', '.claude/skills'],
    sources: ['https://ampcode.com/docs/customize/skills'],
  },
  { agent: 'zed', dirs: ['.agents/skills'], sources: ['https://zed.dev/docs/ai/skills.md'] },
  {
    agent: 'junie',
    dirs: ['.junie/skills'],
    sources: ['https://junie.jetbrains.com/docs/agent-skills.html'],
  },
  { agent: 'kiro', dirs: ['.kiro/skills'], sources: ['https://kiro.dev/docs/skills/'] },
  {
    agent: 'goose',
    dirs: ['.agents/skills', '.goose/skills', '.claude/skills'],
    sources: ['https://goose-docs.ai/docs/guides/context-engineering/using-skills'],
  },
  {
    agent: 'augment',
    dirs: ['.agents/skills', '.augment/skills', '.claude/skills'],
    sources: ['https://docs.augmentcode.com/cli/skills.md'],
  },
  {
    agent: 'qwen-code',
    dirs: ['.agents/skills', '.qwen/skills'],
    sources: ['https://qwenlm.github.io/qwen-code-docs/en/users/features/skills/'],
  },
  {
    agent: 'factory-droid',
    dirs: ['.agents/skills', '.factory/skills'],
    sources: ['https://docs.factory.com/harness/skills.md'],
  },
  { agent: 'trae', dirs: ['.trae/skills'], sources: ['https://docs.trae.ai/ide/skills'] },
  {
    agent: 'warp',
    dirs: ['.agents/skills', '.warp/skills', '.claude/skills'],
    sources: ['https://docs.warp.dev/agents/capabilities/skills/'],
  },
  {
    agent: 'generic',
    dirs: ['.agents/skills'],
    sources: ['https://agentskills.io/client-implementation/adding-skills-support.md'],
  },
]

export const skillAdapters: Adapter[] = TARGETS.map((t) => ({
  format: 'agent-skill',
  agent: t.agent,
  target: `${t.dirs[0]}/<slug>/`,
  sources: t.sources,
  compile(cap, ctx) {
    const dir = `${ctx.pickDir(t.dirs)}/${slugOf(cap)}`
    return ok(cap.files.map((f) => fileOp(`${dir}/${f.path}`, f.content)))
  },
}))

export const skillGaps: KnownGap[] = [
  {
    format: 'agent-skill',
    agent: 'aider',
    reason: 'Aider does not document Agent Skills.',
    sources: ['https://aider.chat/docs/usage/conventions.html'],
  },
  {
    format: 'agent-skill',
    agent: 'continue',
    reason:
      'Continue does not document Agent Skills (support exists only in source code), and the project has had no release since 2.0.0 (2026-06-19).',
    sources: ['https://github.com/continuedev/continue'],
  },
]
