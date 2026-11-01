/**
 * Where the site's evidence comes from. Server only.
 *
 * Production (`next build`, `next start`) reads the real registry: $SIGIL_REGISTRY, else
 * <repo>/registry.json from `sigil registry`, else one built in-process from <repo>/catalog with core's
 * own builder. It refuses the demo fixture outright. Development defaults to the DEMO fixture so the
 * field has something to show; `SIGIL_DATA=real pnpm dev` previews production data.
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import {
  buildRegistry,
  loadTaxonomy,
  Registry,
  type RegistryEntry,
  type Taxonomy,
  Trace,
} from 'sigil/core'
import { type CapView, toView } from '../model'

// Data is read while pages are prerendered, never per request, so none of it is traced into the
// server bundle.
const SITE = process.cwd()
const REPO_ROOT = resolve(/*turbopackIgnore: true*/ SITE, '..')
const FIXTURES = join(/*turbopackIgnore: true*/ SITE, 'fixtures')

export interface Data {
  registry: Registry
  entries: RegistryEntry[]
  views: CapView[]
  demo: boolean
  /** Human description of the source, shown in the machine view. */
  source: string
  /** Root that registry paths (capability dirs, traces) are relative to. */
  root: string
  commit?: string
}

let cached: Promise<Data> | undefined

export function getData(): Promise<Data> {
  cached ??= load()
  return cached
}

async function load(): Promise<Data> {
  const production = process.env.NODE_ENV === 'production'
  const wanted = process.env.SIGIL_DATA ?? (production ? 'real' : 'demo')
  if (wanted !== 'real' && wanted !== 'demo') throw new Error(`SIGIL_DATA must be real or demo`)
  if (production && wanted === 'demo') {
    throw new Error('SIGIL_DATA=demo is for development only; production builds read real evidence')
  }

  let raw: unknown
  let source: string
  let root = REPO_ROOT
  if (wanted === 'demo') {
    raw = JSON.parse(await readFile(join(FIXTURES, 'demo-registry.json'), 'utf8'))
    source = 'site/fixtures/demo-registry.json (DEMO: simulated runs, not measurements)'
    root = FIXTURES
  } else {
    const explicit = process.env.SIGIL_REGISTRY
    const path = explicit
      ? resolve(/*turbopackIgnore: true*/ SITE, explicit)
      : join(/*turbopackIgnore: true*/ REPO_ROOT, 'registry.json')
    if (isInside(path, FIXTURES) || /demo-registry\.json$/.test(path)) {
      throw new Error(`refusing to read the demo fixture as real evidence: ${path}`)
    }
    if (existsSync(path)) {
      raw = JSON.parse(await readFile(path, 'utf8'))
      source = relative(REPO_ROOT, path) || path
    } else if (explicit) {
      throw new Error(`SIGIL_REGISTRY points at a missing file: ${path}`)
    } else {
      const commit = gitCommit()
      const built = await buildRegistry(REPO_ROOT, commit ? { commit } : {})
      raw = built.registry
      source = 'built from catalog/ at build time (no registry.json found)'
    }
  }

  const isDemo =
    typeof raw === 'object' && raw !== null && (raw as { demo?: unknown }).demo === true
  if (wanted === 'real' && isDemo) {
    throw new Error('the registry is marked demo: true; production builds read real evidence only')
  }
  const { demo: _demo, ...rest } = raw as Record<string, unknown>
  const registry = Registry.parse(rest)
  const entries = registry.capabilities
  return {
    registry,
    entries,
    views: entries.map(toView),
    demo: isDemo,
    source,
    root,
    ...(registry.commit ? { commit: registry.commit } : {}),
  }
}

function isInside(path: string, dir: string) {
  const rel = relative(dir, path)
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith(sep) && !rel.includes(`..${sep}`))
}

function gitCommit(): string | undefined {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim()
  } catch {
    return undefined
  }
}

export async function getEntry(ns: string, slug: string): Promise<RegistryEntry | undefined> {
  const { entries } = await getData()
  return entries.find((e) => e.manifest.id === `${ns}/${slug}`)
}

/* --------------------------------------------------------------------------------------------- */

export interface TracePair {
  suite: string
  task: string
  run: number
  baseline?: Trace
  treatment?: Trace
}

const traceCache = new Map<string, Promise<Trace[]>>()

/** Every trace recorded for this entry's current evidence, validated against the Trace schema. */
export function getTraces(entry: RegistryEntry): Promise<Trace[]> {
  const key = `${entry.manifest.id}@${entry.digest}`
  let p = traceCache.get(key)
  if (!p) {
    p = loadTraces(entry)
    traceCache.set(key, p)
  }
  return p
}

async function loadTraces(entry: RegistryEntry): Promise<Trace[]> {
  const ev = entry.evidence
  if (!ev || ev.digest !== entry.digest) return []
  const { root } = await getData()
  const out: Trace[] = []
  for (const run of ev.uplift) {
    if (!run.traces) continue
    const dir = resolve(/*turbopackIgnore: true*/ root, run.traces)
    if (!isInside(dir, root)) continue
    for (const file of await walkJson(dir)) {
      const parsed = Trace.safeParse(JSON.parse(await readFile(file, 'utf8')))
      if (!parsed.success) continue
      const t = parsed.data
      if (t.capability === entry.manifest.id && t.version === entry.manifest.version) out.push(t)
    }
  }
  return out.sort(
    (a, b) =>
      a.suite.localeCompare(b.suite) ||
      a.task.localeCompare(b.task) ||
      a.run - b.run ||
      a.condition.localeCompare(b.condition),
  )
}

async function walkJson(dir: string, depth = 0): Promise<string[]> {
  if (depth > 6) return []
  let names: import('node:fs').Dirent[]
  try {
    names = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const out: string[] = []
  for (const n of names) {
    const p = join(dir, n.name)
    if (n.isDirectory()) out.push(...(await walkJson(p, depth + 1)))
    else if (n.isFile() && n.name.endsWith('.json')) out.push(p)
  }
  return out
}

export function pairTraces(traces: Trace[]): TracePair[] {
  const pairs = new Map<string, TracePair>()
  for (const t of traces) {
    const key = `${t.suite}\u0000${t.task}\u0000${t.run}`
    const pair = pairs.get(key) ?? { suite: t.suite, task: t.task, run: t.run }
    pair[t.condition] = t
    pairs.set(key, pair)
  }
  return [...pairs.values()]
}

/* --------------------------------------------------------------------------------------------- */

let taxonomy: Promise<Taxonomy | undefined> | undefined

/** The technology vocabulary is the repo's, in demo mode too: it is vocabulary, not evidence. */
export function getTaxonomy(): Promise<Taxonomy | undefined> {
  taxonomy ??= loadTaxonomy(REPO_ROOT)
  return taxonomy
}

export async function getMethodology(): Promise<{ markdown: string; source: string }> {
  const spec = join(REPO_ROOT, 'spec', 'METHODOLOGY.md')
  if (existsSync(spec))
    return { markdown: await readFile(spec, 'utf8'), source: 'spec/METHODOLOGY.md' }
  return {
    markdown: await readFile(join(SITE, 'content', 'method.md'), 'utf8'),
    source: 'site/content/method.md (placeholder until spec/METHODOLOGY.md exists)',
  }
}

/** Reads a payload file of a DEMO capability. Development only; production has no demo files. */
export async function readDemoFile(path: string): Promise<Buffer | undefined> {
  if (process.env.NODE_ENV === 'production') return undefined
  const data = await getData()
  if (!data.demo) return undefined
  const abs = resolve(FIXTURES, path)
  if (!isInside(abs, join(FIXTURES, 'catalog'))) return undefined
  try {
    return await readFile(abs)
  } catch {
    return undefined
  }
}
