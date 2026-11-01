/**
 * Extra guard rails for Claude Code on the host runner, where there is no container. They live in
 * the isolated settings passed with --settings and hold in bypassPermissions mode:
 *
 * - permission deny rules for credentials and the operator's own Claude config, written for both the
 *   isolated HOME (`~`) and the operator's real home (absolute `//` paths). With the OS sandbox on,
 *   Claude Code also applies Read denials to what Bash may read.
 * - a PreToolUse hook that blocks Edit/Write/NotebookEdit outside the run's work dir. Deny rules
 *   cannot express "everything except this directory", a hook can, and a hook that exits 2 blocks
 *   the call whatever the permission mode.
 */

/** Directories and files under a home the agent must never read or change. */
const SECRET_DIRS = [
  'Library/Keychains',
  '.ssh',
  '.aws',
  '.config/gh',
  '.gnupg',
  '.docker',
  '.kube',
]
const SECRET_FILES = ['.npmrc', '.netrc', '.pypirc', '.git-credentials']
/** The operator's own agent config, memory and instructions: isolation, not just secrecy. */
const OPERATOR_ONLY_DIRS = ['.claude', '.codex', '.gemini', '.cursor']
const OPERATOR_ONLY_FILES = ['.claude.json']

export function hostDenyRules(operatorHome: string): string[] {
  const real = `//${operatorHome.replace(/^\/+/, '').replace(/\/+$/, '')}`
  const rules = ['Bash(security:*)']
  const both = (base: string, dirs: readonly string[], files: readonly string[]) => {
    for (const d of dirs) rules.push(`Read(${base}/${d}/**)`, `Edit(${base}/${d}/**)`)
    for (const f of files) rules.push(`Read(${base}/${f})`, `Edit(${base}/${f})`)
  }
  both('~', SECRET_DIRS, SECRET_FILES)
  both(real, SECRET_DIRS, SECRET_FILES)
  both(real, OPERATOR_ONLY_DIRS, OPERATOR_ONLY_FILES)
  // Belt and braces next to the hook: nothing under either home is the agent's to edit.
  rules.push('Edit(~/**)', `Edit(${real}/**)`)
  return rules
}

/**
 * The hook, run as `node -e` by Claude Code with the hook payload on stdin. Self-contained for
 * serialization, like the proxy program. Exit 2 blocks the tool call and shows stderr to the agent.
 */
export function hostGuardProgram(workDir: string): void {
  const fs = process.getBuiltinModule('node:fs')
  const path = process.getBuiltinModule('node:path')
  // Annotated so TypeScript knows control never continues after a block.
  const block: (why: string) => never = (why) => {
    process.stderr.write(`Blocked by the Sigil lab: ${why}`)
    process.exit(2)
  }
  let input: { cwd?: unknown; tool_name?: unknown; tool_input?: Record<string, unknown> }
  try {
    input = JSON.parse(fs.readFileSync(0, 'utf8')) as typeof input
  } catch {
    block('unreadable hook input')
  }
  const ti = input.tool_input ?? {}
  const target = [ti.file_path, ti.notebook_path, ti.path].find(
    (v): v is string => typeof v === 'string',
  )
  if (!target) process.exit(0)
  const strip = (p: string) => p.replace(/^\/private(?=\/)/, '')
  const base = typeof input.cwd === 'string' ? input.cwd : workDir
  const abs = path.resolve(base, target)
  // Follow symlinks so a link inside the work dir cannot point out of it.
  let real = abs
  try {
    real = fs.realpathSync(abs)
  } catch {
    try {
      real = path.join(fs.realpathSync(path.dirname(abs)), path.basename(abs))
    } catch {
      // A new file in a new directory: judged by its lexical path.
    }
  }
  const root = strip(workDir.replace(/\/+$/, ''))
  const inside = (p: string) => strip(p) === root || strip(p).startsWith(`${root}/`)
  if (inside(abs) && inside(real)) process.exit(0)
  block(
    `${String(input.tool_name ?? 'this tool')} may only change files inside ${workDir}, not ${target}.`,
  )
}

/** The hook command line: absolute node, program and work dir baked in, single-quoted for sh. */
export function hostGuardCommand(workDir: string, node = process.execPath): string {
  const src = `(${hostGuardProgram.toString()})(${JSON.stringify(workDir)})`
  const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`
  return `${q(node)} -e ${q(src)}`
}

/** The isolated settings for a host run. */
export function hostSettings(workDir: string, operatorHome: string): Record<string, unknown> {
  return {
    sandbox: { enabled: true, autoAllowBashIfSandboxed: true, allowUnsandboxedCommands: false },
    permissions: { deny: hostDenyRules(operatorHome) },
    hooks: {
      PreToolUse: [
        {
          matcher: 'Edit|Write|MultiEdit|NotebookEdit',
          hooks: [{ type: 'command', command: hostGuardCommand(workDir) }],
        },
      ],
    },
  }
}
