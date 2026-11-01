import { createHash } from 'node:crypto'
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { main } from '../../src/cli/main.js'
import type { InstallContext } from '../../src/compile/context.js'
import type { FetchLike } from '../../src/compile/source.js'
import type { CapabilityInput } from '../../src/compile/types.js'
import { buildRegistry, digestDir, loadCapability } from '../../src/core/index.js'

export const REPO = join(import.meta.dirname, '..', 'fixtures', 'compile', 'repo')
export const COMMIT = 'a'.repeat(40)
export const REGISTRY_URL = 'https://sigil-lab.vercel.app/registry.json'

export const capDir = (path: string) => join(REPO, 'catalog', path)

/** Loads a fixture capability into memory, as `sigil add` would after verification. */
export async function input(path: string): Promise<CapabilityInput> {
  const dir = capDir(path)
  const loaded = await loadCapability(dir)
  if (!loaded.manifest) throw new Error(`fixture ${path} is invalid`)
  const { digest, files } = await digestDir(dir)
  return {
    manifest: loaded.manifest,
    digest,
    files: files.map((f) => ({ path: f.path, content: readFileSync(join(dir, f.path)) })),
  }
}

/** A capability built in memory from a manifest override and payload files. */
export async function inline(
  path: string,
  files: Record<string, string>,
  entry?: string,
): Promise<CapabilityInput> {
  const base = await input(path)
  return {
    ...base,
    manifest: {
      ...base.manifest,
      payload: { ...base.manifest.payload, entry: entry ?? base.manifest.payload.entry },
    },
    files: Object.entries(files).map(([p, c]) => ({ path: p, content: Buffer.from(c) })),
  }
}

export function tempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sigil-project-'))
  mkdirSync(join(dir, '.git'))
  return dir
}

/** Every path under a directory (except .git) with its sha256, including empty directories. */
export function tree(root: string): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (rel: string) => {
    for (const name of readdirSync(join(root, rel)).sort()) {
      if (rel === '' && name === '.git') continue
      const p = rel ? `${rel}/${name}` : name
      const st = statSync(join(root, p))
      if (st.isDirectory()) {
        out[`${p}/`] = 'dir'
        walk(p)
      } else {
        out[p] = `${createHash('sha256')
          .update(readFileSync(join(root, p)))
          .digest('hex')} ${(st.mode & 0o777).toString(8)}`
      }
    }
  }
  walk('')
  return out
}

export const read = (root: string, p: string) => readFileSync(join(root, p), 'utf8')

export interface Run {
  code: number
  out: string
  err: string
}

export async function sigil(
  argv: string[],
  cwd: string,
  extra: Partial<InstallContext> = {},
): Promise<Run> {
  const out: string[] = []
  const err: string[] = []
  const ctx: InstallContext = {
    cwd,
    out: (l = '') => out.push(l),
    err: (l = '') => err.push(l),
    fetch: () => Promise.reject(new Error('network is disabled in tests')),
    confirm: async () => false,
    now: () => new Date('2026-11-01T12:00:00.000Z'),
    ...extra,
  }
  const code = await main(argv, ctx)
  // biome-ignore lint/suspicious/noControlCharactersInRegex: strip ANSI colours for assertions
  const strip = (s: string[]) => s.join('\n').replace(/\u001b\[[0-9;]*m/g, '')
  return { code, out: strip(out), err: strip(err) }
}

/**
 * A fake raw.githubusercontent.com serving the fixture repo at COMMIT, plus its registry.json.
 * `tamper` rewrites a served file to simulate a compromised mirror.
 */
export async function fakeGitHub(
  opts: {
    tamper?: (url: string, body: Buffer) => Buffer
    mutate?: (registry: Record<string, unknown>) => void
  } = {},
) {
  const { registry } = await buildRegistry(REPO, { commit: COMMIT, now: new Date(0) })
  const json = JSON.parse(JSON.stringify(registry)) as Record<string, unknown>
  opts.mutate?.(json)
  const urls: string[] = []
  const fetch: FetchLike = async (url) => {
    urls.push(url)
    let body: Buffer | undefined
    if (url === REGISTRY_URL) body = Buffer.from(JSON.stringify(json))
    const prefix = `https://raw.githubusercontent.com/dgesteves/sigil/${COMMIT}/`
    if (url.startsWith(prefix)) {
      try {
        body = readFileSync(join(REPO, ...decodeURIComponent(url.slice(prefix.length)).split('/')))
      } catch {}
    }
    if (body && opts.tamper) body = opts.tamper(url, body)
    return {
      ok: !!body,
      status: body ? 200 : 404,
      arrayBuffer: async () => new Uint8Array(body ?? Buffer.alloc(0)).buffer,
    }
  }
  return { fetch, urls, registry: json }
}

export function copyRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sigil-repo-'))
  cpSync(REPO, dir, { recursive: true })
  return dir
}
