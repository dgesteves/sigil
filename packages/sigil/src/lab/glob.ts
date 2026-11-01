export interface GlobOptions {
  /** Match from the root even when the pattern has no slash (`.bashrc` is only `~/.bashrc`). */
  anchored?: boolean
}

/**
 * Minimal glob matching for task `protected` patterns: `**` crosses directories, `*` and `?` do not.
 * Patterns are POSIX paths relative to the repo root. A pattern without a slash matches at any depth,
 * like .gitignore, so `*.test.ts` protects every test file.
 */
export function globToRegExp(pattern: string, opts: GlobOptions = {}): RegExp {
  const anchored = opts.anchored || (pattern.includes('/') && !pattern.startsWith('**/'))
  // `dir/**` means the directory and everything in it; the suffix below already covers "in it".
  const body = pattern
    .replace(/^\.\//, '')
    .replace(/^\//, '')
    .replace(/\/\*\*$/, '')
  let re = ''
  for (let i = 0; i < body.length; i++) {
    const c = body[i]!
    if (c === '*') {
      if (body[i + 1] === '*') {
        // `**/` matches zero or more directories; a trailing `**` matches everything below.
        if (body[i + 2] === '/') {
          re += '(?:.*/)?'
          i += 2
        } else {
          re += '.*'
          i += 1
        }
      } else {
        re += '[^/]*'
      }
    } else if (c === '?') {
      re += '[^/]'
    } else if ('\\^$+.()|{}[]'.includes(c)) {
      re += `\\${c}`
    } else {
      re += c
    }
  }
  // A directory pattern (`test/` or `test`) protects everything inside it.
  const suffix = body.endsWith('/') ? '.*' : '(?:/.*)?'
  return new RegExp(`^${anchored ? '' : '(?:.*/)?'}${re}${suffix}$`)
}

export function matcher(
  patterns: readonly string[],
  opts: GlobOptions = {},
): (path: string) => boolean {
  const res = patterns.map((p) => globToRegExp(p, opts))
  return (path) => res.some((r) => r.test(path))
}
