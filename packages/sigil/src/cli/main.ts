#!/usr/bin/env node
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import pc from 'picocolors'
import pkg from '../../package.json' with { type: 'json' }
import { type Command, type CommandContext, fmt, parse } from './command.js'
import { digest } from './commands/digest.js'
import { registry } from './commands/registry.js'
import { scan } from './commands/scan.js'
import { validate } from './commands/validate.js'

/** Every command lives in ./commands/<name>.ts and is registered here, in help order. */
export const COMMANDS: Command[] = [validate, scan, digest, registry]

const { version } = pkg

export async function main(argv: string[], ctx: CommandContext): Promise<number> {
  const [name, ...rest] = argv
  if (!name || name === '--help' || name === '-h' || name === 'help') {
    ctx.out(`${pc.bold('sigil')} ${fmt.dim(version)} — every agent capability, proven`)
    ctx.out()
    for (const c of COMMANDS) ctx.out(`  ${c.name.padEnd(12)} ${c.summary}`)
    ctx.out()
    ctx.out(fmt.dim('Run sigil <command> --help for details.'))
    return 0
  }
  if (name === '--version' || name === '-v') {
    ctx.out(version)
    return 0
  }
  const cmd = COMMANDS.find((c) => c.name === name)
  if (!cmd) {
    ctx.err(fmt.fail(`unknown command "${name}". Run sigil --help.`))
    return 2
  }
  let args: ReturnType<typeof parse>
  try {
    args = parse(cmd, rest)
  } catch (e) {
    ctx.err(fmt.fail((e as Error).message))
    ctx.err(`usage: ${cmd.usage}`)
    return 2
  }
  if (args.values.help) {
    ctx.out(`usage: ${cmd.usage}`)
    ctx.out()
    ctx.out(cmd.summary)
    return 0
  }
  return cmd.run(args, ctx)
}

function isEntry(): boolean {
  if (!process.argv[1]) return false
  try {
    // npx and global installs run us through a symlink in node_modules/.bin.
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
  } catch {
    return false
  }
}

if (isEntry()) {
  main(process.argv.slice(2), {
    cwd: process.cwd(),
    out: (l = '') => process.stdout.write(`${l}\n`),
    err: (l = '') => process.stderr.write(`${l}\n`),
  }).then(
    (code) => {
      process.exitCode = code
    },
    (e: unknown) => {
      process.stderr.write(`${fmt.fail(e instanceof Error ? (e.stack ?? e.message) : String(e))}\n`)
      process.exitCode = 1
    },
  )
}
