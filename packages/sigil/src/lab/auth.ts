import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const TOKEN_ENV = 'CLAUDE_CODE_OAUTH_TOKEN'
export const DEFAULT_AUTH_FILE = join(homedir(), '.config', 'sigil', 'claude-oauth-token')

export type Auth =
  | { kind: 'token'; token: string; source: string }
  | { kind: 'keychain' }
  | { kind: 'none' }

export class AuthError extends Error {}

export const SETUP_HELP = [
  'Create a long-lived Claude Code token once (needs a Claude subscription) and store it for the lab:',
  '  claude setup-token',
  '  mkdir -p ~/.config/sigil',
  '  (umask 077; read -rs t; printf \'%s\' "$t" > ~/.config/sigil/claude-oauth-token)   # paste, then Enter',
  `Or export ${TOKEN_ENV} for one session. Sigil passes the token to the sandbox as an environment`,
  'variable only: never as an argument, never written to disk, and redacted from every trace and log.',
].join('\n')

/**
 * Finds the agent token: the environment first, then the auth file, which must be private (no
 * group or other permission bits) because it is a long-lived credential.
 */
export interface TokenOptions {
  /** Explicit --auth-file: must exist. */
  authFile?: string
  /** Where to look when no --auth-file is given (tests point this away from the real one). */
  defaultFile?: string
  env?: NodeJS.ProcessEnv
}

export async function readToken(
  opts: TokenOptions = {},
): Promise<{ token: string; source: string } | undefined> {
  const env = opts.env ?? process.env
  const fromEnv = env[TOKEN_ENV]?.trim()
  if (fromEnv) return { token: fromEnv, source: `$${TOKEN_ENV}` }
  const file = opts.authFile ?? opts.defaultFile ?? DEFAULT_AUTH_FILE
  let mode: number
  try {
    mode = (await stat(file)).mode
  } catch {
    if (opts.authFile) throw new AuthError(`auth file not found: ${file}`)
    return undefined
  }
  if ((mode & 0o077) !== 0) {
    throw new AuthError(
      `${file} is readable by other users (mode ${(mode & 0o777).toString(8)}); run chmod 600 ${file}`,
    )
  }
  const token = (await readFile(file, 'utf8')).trim()
  if (!token) throw new AuthError(`${file} is empty`)
  if (/\s/.test(token)) throw new AuthError(`${file} must contain only the token`)
  return { token, source: file }
}

/**
 * Docker always needs a token: the operator's keychain must never be reachable from a container.
 * The host runner can fall back to the agent's own keychain login on macOS.
 */
export async function resolveAuth(
  opts: TokenOptions & { runner: 'docker' | 'host'; platform?: NodeJS.Platform },
): Promise<Auth> {
  const found = await readToken(opts)
  if (found) return { kind: 'token', ...found }
  if (opts.runner === 'host' && (opts.platform ?? process.platform) === 'darwin')
    return { kind: 'keychain' }
  throw new AuthError(`no Claude Code token found.\n${SETUP_HELP}`)
}
