import { readFile, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { digestOf, sha256Hex } from '../core/digest.js'
import { isDirectory, loadCapability } from '../core/load.js'
import { buildRegistry } from '../core/registry.js'
import {
  CapabilityId,
  GitSha,
  type Registry,
  type RegistryEntry,
  Registry as RegistrySchema,
} from '../core/schema.js'
import type { LockSource } from './lockfile.js'
import type { CapabilityInput, PayloadFile } from './types.js'
import { type PathError, safeRelative } from './workspace.js'

export const DEFAULT_REGISTRY =
  'https://raw.githubusercontent.com/dgesteves/sigil/main/registry.json'
const DEFAULT_RAW_BASE = 'https://raw.githubusercontent.com/dgesteves/sigil'
const MAX_FILE_BYTES = 1_000_000
const MAX_REGISTRY_BYTES = 50_000_000

/** The subset of `fetch` Sigil uses, so tests can inject one and never touch the network. */
export type FetchLike = (url: string) => Promise<{
  ok: boolean
  status: number
  arrayBuffer(): Promise<ArrayBuffer>
}>

export class SourceError extends Error {}
/** A payload did not match its registry hashes. Never installed, never retried silently. */
export class IntegrityError extends SourceError {}

export interface Resolved {
  input: CapabilityInput
  source: LockSource
  /** The registry entry, when the capability came from a registry. */
  entry?: RegistryEntry
}

const looksLikePath = (spec: string) =>
  /^(\.{1,2}(\/|$)|\/)/.test(spec) || (spec.includes('/') && !CapabilityId.safeParse(spec).success)

async function fetchBytes(fetchFn: FetchLike, url: string, limit: number): Promise<Buffer> {
  let res: Awaited<ReturnType<FetchLike>>
  try {
    res = await fetchFn(url)
  } catch (e) {
    throw new SourceError(`could not fetch ${url}: ${(e as Error).message}`)
  }
  if (!res.ok) throw new SourceError(`could not fetch ${url}: HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.byteLength > limit) throw new SourceError(`${url} is larger than ${limit} bytes`)
  return buf
}

/* ------------------------------------------------------------------------------------------------
 * Local capability directory: `sigil add ./path/to/capability`.
 * ---------------------------------------------------------------------------------------------- */

export async function resolveLocal(
  dir: string,
  cwd: string,
  projectRoot: string,
): Promise<Resolved> {
  const abs = resolve(cwd, dir)
  if (!(await isDirectory(abs))) throw new SourceError(`not a directory: ${dir}`)
  const loaded = await loadCapability(abs)
  const blocking = loaded.findings.filter((f) => f.severity === 'high' || f.severity === 'critical')
  if (!loaded.manifest || blocking.length) {
    const why = (blocking.length ? blocking : loaded.findings)
      .map((f) => `${f.rule} ${f.message}`)
      .join('; ')
    throw new SourceError(`${dir} is not a valid capability: ${why || 'invalid manifest'}`)
  }
  if (loaded.manifest.source || !loaded.digest)
    throw new SourceError(
      `${loaded.manifest.id} is hosted upstream; install it from a registry instead`,
    )
  const files = await Promise.all(
    loaded.files.map(async (f) => ({
      path: f.path,
      content: await readFile(join(abs, ...f.path.split('/'))),
    })),
  )
  const input = verify(
    { manifest: loaded.manifest, digest: loaded.digest, files },
    loaded.files,
    loaded.digest,
  )
  const rel = relative(projectRoot, abs).split(sep).join('/')
  return { input, source: { kind: 'path', path: rel === '' ? '.' : rel } }
}

/* ------------------------------------------------------------------------------------------------
 * Registries: a registry.json URL, a registry.json file, or a local Sigil checkout (catalog/).
 * ---------------------------------------------------------------------------------------------- */

export interface RegistryHandle {
  /** What the user passed (or the default URL), recorded in the lockfile. */
  label: string
  registry: Registry
  /** Reads payload files for an entry, from disk or over the network. */
  files(entry: RegistryEntry): Promise<PayloadFile[]>
  commit?: string
}

export async function openRegistry(
  spec: string | undefined,
  cwd: string,
  fetchFn: FetchLike,
): Promise<RegistryHandle> {
  const label = spec ?? DEFAULT_REGISTRY
  if (/^https?:\/\//.test(label)) {
    if (!label.startsWith('https://'))
      throw new SourceError('registries must be fetched over https')
    const raw = await fetchBytes(fetchFn, label, MAX_REGISTRY_BYTES)
    const registry = parseRegistry(raw, label)
    const commit = registry.commit
    if (!commit || !GitSha.safeParse(commit).success)
      throw new SourceError(
        `${label} does not pin a commit, so its payloads cannot be fetched immutably`,
      )
    return {
      label,
      registry,
      commit,
      files: (entry) => fetchFiles(fetchFn, rawBase(label), commit, entry),
    }
  }

  const abs = resolve(cwd, label)
  let file = abs
  if (await isDirectory(abs)) {
    file = join(abs, 'registry.json')
    if (!(await exists(file))) {
      if (!(await isDirectory(join(abs, 'catalog'))))
        throw new SourceError(`${label} has no registry.json and no catalog/`)
      // A local Sigil checkout: build the registry in memory, read payloads from the catalog.
      const { registry } = await buildRegistry(abs)
      return { label, registry, files: (entry) => readLocalFiles(abs, entry) }
    }
  }
  const registry = parseRegistry(
    await readFile(file).catch(() => {
      throw new SourceError(`cannot read ${label}`)
    }),
    label,
  )
  const root = dirname(file)
  const commit =
    registry.commit && GitSha.safeParse(registry.commit).success ? registry.commit : undefined
  return {
    label,
    registry,
    ...(commit ? { commit } : {}),
    files: async (entry) => {
      // Prefer the files next to the registry (a checkout); fall back to the pinned commit online.
      if (await isDirectory(join(root, ...safeRelative(entry.path).split('/'))))
        return readLocalFiles(root, entry)
      if (!commit)
        throw new SourceError(
          `${entry.path} is not next to ${label} and the registry pins no commit`,
        )
      return fetchFiles(fetchFn, DEFAULT_RAW_BASE, commit, entry)
    },
  }
}

function fetchFiles(
  fetchFn: FetchLike,
  base: string,
  commit: string,
  entry: RegistryEntry,
): Promise<PayloadFile[]> {
  return Promise.all(
    entry.files.map(async (f) => ({
      path: f.path,
      content: await fetchBytes(
        fetchFn,
        `${base}/${commit}/${encodePath(entry.path)}/${encodePath(f.path)}`,
        MAX_FILE_BYTES,
      ),
    })),
  )
}

function parseRegistry(raw: Buffer, label: string): Registry {
  let json: unknown
  try {
    json = JSON.parse(raw.toString('utf8'))
  } catch {
    throw new SourceError(`${label} is not valid JSON`)
  }
  const parsed = RegistrySchema.safeParse(json)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!
    throw new SourceError(
      `${label} is not a Sigil registry: ${issue.path.join('.') || '(root)'}: ${issue.message}`,
    )
  }
  return parsed.data
}

/** `https://raw.githubusercontent.com/<owner>/<repo>/<ref>/registry.json` → the same repo; else Sigil's. */
function rawBase(url: string): string {
  const m = /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\//.exec(url)
  return m ? `https://raw.githubusercontent.com/${m[1]}/${m[2]}` : DEFAULT_RAW_BASE
}

const encodePath = (p: string) => safeRelative(p).split('/').map(encodeURIComponent).join('/')

async function readLocalFiles(root: string, entry: RegistryEntry): Promise<PayloadFile[]> {
  const dir = join(root, ...safeRelative(entry.path).split('/'))
  return Promise.all(
    entry.files.map(async (f) => {
      const path = join(dir, ...safeRelative(f.path).split('/'))
      const st = await stat(path).catch(() => undefined)
      if (!st?.isFile()) throw new IntegrityError(`${entry.manifest.id}: ${f.path} is missing`)
      if (st.size > MAX_FILE_BYTES)
        throw new IntegrityError(`${entry.manifest.id}: ${f.path} is larger than 1 MB`)
      return { path: f.path, content: await readFile(path) }
    }),
  )
}

export async function resolveFromRegistry(handle: RegistryHandle, id: string): Promise<Resolved> {
  const entry = handle.registry.capabilities.find((c) => c.manifest.id === id)
  if (!entry) throw new SourceError(`${id} is not in ${handle.label}`)
  if (entry.level === 'revoked') {
    const why = entry.evidence?.revoked?.reason
    throw new SourceError(`${id} is revoked${why ? `: ${why}` : ''}. Sigil will not install it.`)
  }
  if (entry.manifest.source)
    throw new SourceError(`${id} is hosted upstream and its payload is not in the registry yet`)
  if (entry.files.length === 0) throw new IntegrityError(`${id} lists no payload files`)
  const files = await handle.files(entry)
  const digest = entry.digest as `sha256:${string}`
  const input = verify({ manifest: entry.manifest, digest, files }, entry.files, digest)
  return {
    input,
    entry,
    source: {
      kind: 'registry',
      registry: handle.label,
      ...(handle.commit ? { commit: handle.commit } : {}),
    },
  }
}

/**
 * Checks every file against the registry's sha256 and size, then recomputes the payload digest.
 * The digest is what the evidence is bound to, so a single changed byte aborts the install.
 */
export function verify(
  input: CapabilityInput,
  expected: readonly { path: string; sha256: string; bytes: number }[],
  digest: string,
): CapabilityInput {
  const id = input.manifest.id
  const byPath = new Map(input.files.map((f) => [f.path, f]))
  for (const e of expected) {
    try {
      safeRelative(e.path)
    } catch (err) {
      throw new IntegrityError(`${id}: ${(err as PathError).message}`)
    }
    const f = byPath.get(e.path)
    if (!f) throw new IntegrityError(`${id}: ${e.path} is missing`)
    if (f.content.byteLength !== e.bytes || sha256Hex(f.content) !== e.sha256)
      throw new IntegrityError(
        `${id}: ${e.path} does not match its registry hash; refusing to install`,
      )
  }
  if (input.files.length !== expected.length)
    throw new IntegrityError(`${id}: unexpected payload files`)
  const actual = digestOf(
    input.files.map((f) => ({
      path: f.path,
      sha256: sha256Hex(f.content),
      bytes: f.content.byteLength,
    })),
  )
  if (actual !== digest)
    throw new IntegrityError(
      `${id}: payload digest ${actual} does not match ${digest}; refusing to install`,
    )
  if (!input.files.some((f) => f.path === input.manifest.payload.entry))
    throw new IntegrityError(`${id}: payload entry ${input.manifest.payload.entry} is missing`)
  return input
}

export function isPathSpec(spec: string): boolean {
  return looksLikePath(spec) || isAbsolute(spec)
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}
