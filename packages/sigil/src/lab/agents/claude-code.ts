import { posix } from 'node:path'
import type { LabCapability } from '../capability.js'
import { compiledInstallFiles } from '../compiled-install.js'
import { hostSettings } from './claude-host.js'
import { parseClaudeStream } from './claude-stream.js'
import type {
  AgentDriver,
  AgentOutcome,
  InstallFile,
  Invocation,
  InvocationSpec,
  IsolationContext,
} from './types.js'

/**
 * Tools disabled in both conditions:
 * - WebFetch/WebSearch: tasks are offline by method, and web lookups would make runs depend on the
 *   internet (WebSearch runs server-side, so the egress proxy cannot see it).
 * - SendMessage/ListAgents: on a host they reach other Claude Code sessions through a shared socket
 *   directory (/tmp/cc-socks), i.e. the operator's own sessions.
 * - Cron*, ScheduleWakeup: schedule work after the run has ended.
 * - EnterWorktree/ExitWorktree: create checkouts outside the work dir.
 */
export const CLAUDE_DISALLOWED_TOOLS = [
  'WebFetch',
  'WebSearch',
  'SendMessage',
  'ListAgents',
  'CronCreate',
  'CronDelete',
  'CronList',
  'ScheduleWakeup',
  'EnterWorktree',
  'ExitWorktree',
] as const

/** The npm package the Docker image installs. */
export const CLAUDE_NPM_PACKAGE = '@anthropic-ai/claude-code'

export const claudeCode: AgentDriver = {
  id: 'claude-code',
  label: 'Claude Code',
  egress: ['api.anthropic.com'],
  // Account-level claude.ai MCP connectors. Fetching them would hand the run the operator's own
  // connectors, so the proxy denies it; the baseline makes the same request (observed 2026-11-01).
  harnessDenied: ['mcp-proxy.anthropic.com'],
  stateGlobs: [
    '.claude.json',
    '.claude.json.backup*',
    '.claude/backups/**',
    '.claude/projects/**',
    '.claude/sessions/**',
    '.claude/session-env/**',
    '.claude/shell-snapshots/**',
    '.claude/todos/**',
    '.claude/tasks/**',
    '.claude/statsig/**',
    '.claude/debug/**',
    '.claude/file-history/**',
    '.claude/cache/**',
    '.claude/plugins/store',
    '.claude/plugins/store/**',
    '.cache/claude-cli-nodejs/**',
    'Library/Caches/claude-cli-nodejs/**',
    // Written by Claude Code itself in every run, both conditions, with no tool call (observed
    // 2026-11-01): a cleanup timestamp and a global gitignore entry for its local settings file.
    // Residual risk: a capability that edits the global gitignore to hide files is not flagged.
    '.claude/.last-cleanup',
    '.config/git/ignore',
    // With token auth (Docker, 2026-11-01): the account's policy limits and remote managed settings,
    // fetched from the API and cached by Claude Code itself in both conditions.
    // Residual risk: a capability that edits these caches is not flagged.
    '.claude/policy-limits.json*',
    '.claude/remote-settings.json*',
  ],
  persistenceGlobs: [
    '.claude/settings.json',
    '.claude/settings.local.json',
    '.claude/CLAUDE.md',
    '.claude/skills/**',
    '.claude/agents/**',
    '.claude/commands/**',
    '.claude/hooks/**',
    '.claude/output-styles/**',
    '.claude/plugins/**',
  ],

  dockerLayers(version) {
    if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`invalid Claude Code version: ${version}`)
    // LOCAL CALIBRATION PATCH (not for commit): bring Node into task images that lack it.
    const node = 'node:24-bookworm@sha256:e7add2a490bb17d97b485b8641bd88455fff7839ade0f5eba493c3508124d413'
    return [
      `COPY --from=${node} /usr/local/bin/node /opt/sigil-node/bin/node`,
      `COPY --from=${node} /usr/local/lib/node_modules/npm /opt/sigil-node/lib/node_modules/npm`,
      'RUN if ! command -v npm >/dev/null 2>&1; then ln -s /opt/sigil-node/bin/node /usr/local/bin/node && ln -s /opt/sigil-node/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm; fi',
      `RUN npm install -g --prefix /usr/local ${CLAUDE_NPM_PACKAGE}@${version} && npm cache clean --force`,
    ]
  },

  versionArgv: () => ['claude', '--version'],
  parseVersion: (stdout) => /(\d+\.\d+\.\d+)/.exec(stdout)?.[1],

  // The real install engine, so the lab measures exactly what `sigil add` writes.
  installFiles: (capability, repoDir) => compiledInstallFiles(capability, 'claude-code', repoDir),

  installedNames(capability) {
    return capability.manifest.payload.format === 'agent-skill' ? [capability.slug] : []
  },

  invocation(spec: InvocationSpec): Invocation {
    const argv = [
      'claude',
      '-p',
      '--model',
      spec.model,
      '--output-format',
      'stream-json',
      '--verbose',
      '--no-session-persistence',
      // Only MCP servers we pass (none). Also stops the operator's user-level servers loading.
      '--strict-mcp-config',
      '--disallowedTools',
      CLAUDE_DISALLOWED_TOOLS.join(','),
    ]
    // Both runners skip approval prompts: a headless run has nobody to answer them, and denials
    // would make the agent work under different rules than a developer's (observed 2026-11-01 with
    // acceptEdits: ordinary test runs were refused). Containment comes from the runner instead.
    argv.push('--permission-mode', 'bypassPermissions')
    if (spec.runner === 'host') {
      // No container on the host: Bash runs in Claude Code's OS sandbox, credentials and the
      // operator's own config are denied, and a hook keeps edits inside the work dir.
      if (!spec.operatorHome)
        throw new Error('the host runner must say whose home to keep the agent out of')
      argv.push('--settings', JSON.stringify(hostSettings(spec.workDir, spec.operatorHome)))
    }
    if (spec.maxBudgetUsd !== undefined) argv.push('--max-budget-usd', String(spec.maxBudgetUsd))
    const env: Record<string, string> = {
      HOME: spec.homeDir,
      TERM: 'dumb',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      DISABLE_AUTOUPDATER: '1',
      DISABLE_TELEMETRY: '1',
      DISABLE_ERROR_REPORTING: '1',
      DISABLE_BUG_COMMAND: '1',
    }
    const secretEnv: Record<string, string> = spec.token
      ? { CLAUDE_CODE_OAUTH_TOKEN: spec.token }
      : {}
    return { argv, env, secretEnv, stdin: spec.prompt }
  },

  parse: (lines, stderr) => parseClaudeStream(lines, stderr),

  isolationProblems(outcome: AgentOutcome, ctx: IsolationContext): string[] {
    const env = outcome.environment
    if (!env) return ['Claude Code did not report its session environment (no init event)']
    const problems: string[] = []
    if (env.mcpServers.length) problems.push(`MCP servers loaded: ${env.mcpServers.join(', ')}`)
    const foreign = env.plugins.filter((p) => p.path !== 'builtin')
    if (foreign.length)
      problems.push(`non-builtin plugins loaded: ${foreign.map((p) => p.name).join(', ')}`)
    const home = ctx.homeDir.replace(/\/+$/, '')
    for (const m of env.memoryPaths) {
      if (!sameOrInside(m, home)) problems.push(`memory path outside the isolated home: ${m}`)
    }
    if (env.cwd && !sameOrInside(env.cwd, ctx.workDir))
      problems.push(`working directory is ${env.cwd}, not the work dir`)
    for (const name of ctx.installed) {
      const has = env.skills.includes(name)
      if (ctx.condition === 'treatment' && !has)
        problems.push(`installed skill "${name}" was not loaded`)
      if (ctx.condition === 'baseline' && has)
        problems.push(`skill "${name}" is visible in the baseline`)
    }
    return problems
  },
}

/** Path comparison that tolerates macOS's /var → /private/var aliasing. */
function sameOrInside(path: string, dir: string): boolean {
  const norm = (p: string) => p.replace(/^\/private\//, '/').replace(/\/+$/, '')
  const p = norm(path)
  const d = norm(dir)
  return p === d || p.startsWith(`${d}/`)
}
