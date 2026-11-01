import { createHash } from 'node:crypto'
import { lstat, readdir, readFile } from 'node:fs/promises'
import { join, posix, relative, sep } from 'node:path'

/**
 * Payload digest: the identity that verification is bound to.
 *
 * It covers exactly the files that get installed, so "what you install is what we tested" is checkable.
 * The manifest (sigil.yaml) and generated evidence are excluded; changing them never changes the digest.
 *
 * The algorithm is plain coreutils, so anyone can reproduce it without Sigil:
 *
 *   cd <capability-dir>
 *   find . -type f ! -name sigil.yaml ! -name evidence.json ! -name .DS_Store ! -path './.git/*' \
 *     | sed 's|^\./||' | LC_ALL=C sort \
 *     | while IFS= read -r f; do shasum -a 256 "$f"; done \
 *     | shasum -a 256
 *
 * i.e. sha256 over lines "<sha256 hex>  <posix path>\n", sorted by path bytes.
 */

export const EXCLUDED_FILES = new Set(['sigil.yaml', 'evidence.json', '.DS_Store'])
export const EXCLUDED_DIRS = new Set(['.git', 'node_modules'])

export interface FileEntry {
  /** POSIX path relative to the capability root. */
  path: string
  sha256: string
  bytes: number
}

export class DigestError extends Error {}

export async function listPayloadFiles(root: string): Promise<FileEntry[]> {
  const out: FileEntry[] = []
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const abs = join(dir, entry.name)
      const rel = relative(root, abs).split(sep).join(posix.sep)
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRS.has(entry.name)) await walk(abs)
        continue
      }
      // Symlinks can point outside the capability and change after verification. Never followed.
      const stat = await lstat(abs)
      if (stat.isSymbolicLink()) throw new DigestError(`symbolic links are not allowed: ${rel}`)
      if (!stat.isFile()) throw new DigestError(`unsupported file type: ${rel}`)
      if (dir === root && EXCLUDED_FILES.has(entry.name)) continue
      if (entry.name === '.DS_Store') continue
      const buf = await readFile(abs)
      out.push({ path: rel, sha256: sha256Hex(buf), bytes: buf.byteLength })
    }
  }
  await walk(root)
  return out.sort((a, b) => compareBytes(a.path, b.path))
}

export function digestOf(files: readonly FileEntry[]): `sha256:${string}` {
  const sorted = [...files].sort((a, b) => compareBytes(a.path, b.path))
  const manifest = sorted.map((f) => `${f.sha256}  ${f.path}\n`).join('')
  return `sha256:${sha256Hex(Buffer.from(manifest, 'utf8'))}`
}

export async function digestDir(
  root: string,
): Promise<{ digest: `sha256:${string}`; files: FileEntry[] }> {
  const files = await listPayloadFiles(root)
  if (files.length === 0) throw new DigestError(`no payload files in ${root}`)
  return { digest: digestOf(files), files }
}

export function sha256Hex(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex')
}

/** `LC_ALL=C sort` order: compare UTF-8 bytes, not UTF-16 code units or locale collation. */
function compareBytes(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'))
}
