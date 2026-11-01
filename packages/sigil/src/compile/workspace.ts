import { randomBytes } from 'node:crypto'
import { chmod, lstat, mkdir, readFile, rename, rmdir, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, posix } from 'node:path'

export class PathError extends Error {}

/** Normalises a project-relative POSIX path, refusing anything that could leave the project. */
export function safeRelative(rel: string): string {
  if (!rel || rel.includes('\0') || rel.includes('\\'))
    throw new PathError(`invalid path: ${JSON.stringify(rel)}`)
  if (rel.startsWith('/') || /^[A-Za-z]:/.test(rel))
    throw new PathError(`absolute paths are not allowed: ${rel}`)
  const norm = posix.normalize(rel)
  if (norm === '.' || norm === '..' || norm.startsWith('../') || norm.split('/').includes('..'))
    throw new PathError(`path escapes the project: ${rel}`)
  return norm.replace(/\/$/, '')
}

export interface Change {
  path: string
  before: Buffer | undefined
  /** `null` deletes the file. */
  after: Buffer | null
  /** Undefined keeps the mode of an existing file (0o644 for a new one). */
  mode: number | undefined
}

/**
 * Staged edits to a project. Nothing touches the disk until `commit`, so a conflict found halfway
 * through a plan leaves the project untouched, and `--dry-run` is the same code path minus commit.
 */
export class Workspace {
  private staged = new Map<string, { after: Buffer | null; mode: number | undefined }>()
  private original = new Map<string, Buffer | undefined>()
  private prune = new Set<string>()

  constructor(readonly root: string) {}

  /** Throws if the path escapes the project or passes through a symlink inside it. */
  async check(rel: string): Promise<string> {
    const norm = safeRelative(rel)
    const parts = norm.split('/')
    for (let i = 1; i <= parts.length; i++) {
      const sub = parts.slice(0, i).join('/')
      try {
        const st = await lstat(join(this.root, sub))
        if (st.isSymbolicLink())
          throw new PathError(`refusing to write through a symbolic link: ${sub}`)
        if (i < parts.length && !st.isDirectory())
          throw new PathError(`${sub} is a file, so ${norm} cannot be created`)
        if (i === parts.length && st.isDirectory()) throw new PathError(`${norm} is a directory`)
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') break
        throw e
      }
    }
    return norm
  }

  async read(rel: string): Promise<Buffer | undefined> {
    const norm = await this.check(rel)
    const staged = this.staged.get(norm)
    if (staged) return staged.after ?? undefined
    return this.disk(norm)
  }

  private async disk(norm: string): Promise<Buffer | undefined> {
    if (this.original.has(norm)) return this.original.get(norm)
    let buf: Buffer | undefined
    try {
      buf = await readFile(join(this.root, norm))
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
    }
    this.original.set(norm, buf)
    return buf
  }

  async write(rel: string, content: Buffer, mode?: number): Promise<void> {
    const norm = await this.check(rel)
    await this.disk(norm)
    this.staged.set(norm, { after: content, mode })
  }

  async delete(rel: string): Promise<void> {
    const norm = await this.check(rel)
    await this.disk(norm)
    this.staged.set(norm, { after: null, mode: undefined })
  }

  /** Directories to remove after commit if they end up empty. */
  pruneDir(rel: string): void {
    this.prune.add(safeRelative(rel))
  }

  /** Whether a directory exists on disk now (before commit). */
  async dirExists(rel: string): Promise<boolean> {
    try {
      return (await lstat(join(this.root, safeRelative(rel)))).isDirectory()
    } catch {
      return false
    }
  }

  changes(): Change[] {
    return [...this.staged.entries()]
      .map(([path, s]) => ({ path, before: this.original.get(path), after: s.after, mode: s.mode }))
      .filter((c) => !(c.after === null && c.before === undefined))
      .filter((c) => !(c.after && c.before?.equals(c.after)))
      .sort((a, b) => a.path.localeCompare(b.path))
  }

  async commit(): Promise<void> {
    for (const c of this.changes()) {
      // Re-check at write time: the tree may have changed since planning.
      await this.check(c.path)
      const abs = join(this.root, c.path)
      if (c.after === null) {
        await unlink(abs).catch((e: NodeJS.ErrnoException) => {
          if (e.code !== 'ENOENT') throw e
        })
        continue
      }
      await mkdir(dirname(abs), { recursive: true })
      const mode =
        c.mode ??
        (await lstat(abs).then(
          (st) => st.mode & 0o777,
          () => 0o644,
        ))
      const tmp = `${abs}.sigil-${randomBytes(4).toString('hex')}.tmp`
      await writeFile(tmp, c.after, { mode })
      await chmod(tmp, mode)
      await rename(tmp, abs)
    }
    const dirs = [...this.prune].sort(
      (a, b) => b.split('/').length - a.split('/').length || b.localeCompare(a),
    )
    for (const d of dirs) {
      await rmdir(join(this.root, d)).catch(() => undefined)
    }
  }
}
