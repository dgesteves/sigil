import { type ParseArgsConfig, parseArgs } from 'node:util'
import pc from 'picocolors'

export interface CommandContext {
  cwd: string
  /** Writes to stdout. Commands print through this so tests can capture output. */
  out: (line?: string) => void
  err: (line?: string) => void
}

export interface Command {
  name: string
  summary: string
  usage: string
  options?: ParseArgsConfig['options']
  /** Returns the process exit code. */
  run: (
    args: { positionals: string[]; values: Record<string, unknown> },
    ctx: CommandContext,
  ) => Promise<number>
}

export function parse(cmd: Command, argv: string[]) {
  const { values, positionals } = parseArgs({
    args: argv,
    options: { help: { type: 'boolean', short: 'h' }, ...(cmd.options ?? {}) },
    allowPositionals: true,
    strict: true,
  })
  return { values: values as Record<string, unknown>, positionals }
}

export const fmt = {
  ok: (s: string) => `${pc.green('✓')} ${s}`,
  fail: (s: string) => `${pc.red('✗')} ${s}`,
  warn: (s: string) => `${pc.yellow('!')} ${s}`,
  dim: pc.dim,
  bold: pc.bold,
}
