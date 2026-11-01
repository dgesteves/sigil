import { lstat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import type { CommandContext } from '../cli/command.js'
import { LOCKFILE } from './lockfile.js'
import type { FetchLike } from './source.js'

/**
 * What install commands need beyond the base CLI context. Every field is optional so the real CLI
 * works unchanged; tests inject a fake fetch, a scripted confirmation and a fixed clock.
 */
export interface InstallContext extends CommandContext {
  fetch?: FetchLike
  confirm?: (question: string) => Promise<boolean>
  now?: () => Date
}

export const realFetch: FetchLike = (url) =>
  fetch(url, { signal: AbortSignal.timeout(30_000), redirect: 'error' })

export function fetchOf(ctx: CommandContext): FetchLike {
  return (ctx as InstallContext).fetch ?? realFetch
}

export function nowOf(ctx: CommandContext): Date {
  return (ctx as InstallContext).now?.() ?? new Date()
}

/** Asks on a TTY; without one (CI, pipes) the answer is "no" so nothing installs unattended. */
export async function confirmOf(ctx: CommandContext, question: string): Promise<boolean> {
  const injected = (ctx as InstallContext).confirm
  if (injected) return injected(question)
  if (!process.stdin.isTTY) return false
  const rl = createInterface({ input: process.stdin, output: process.stderr })
  try {
    return /^y(es)?$/i.test((await rl.question(`${question} [y/N] `)).trim())
  } finally {
    rl.close()
  }
}

/** The project root: the nearest folder with a lockfile or a .git, else the working directory. */
export async function findProjectRoot(cwd: string): Promise<string> {
  const start = resolve(cwd)
  for (let dir = start; ; dir = dirname(dir)) {
    for (const marker of [LOCKFILE, '.git']) {
      try {
        await lstat(join(dir, marker))
        return dir
      } catch {}
    }
    if (dirname(dir) === dir) return start
  }
}
