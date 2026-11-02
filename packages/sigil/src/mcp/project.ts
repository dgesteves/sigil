import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import {
  baseName,
  MANIFESTS,
  matchesPackage,
  matchFiles,
  packageIndex,
  packagesIn,
  pickManifests,
} from '../core/stack.js'
import type { Technology } from '../core/taxonomy.js'

export interface DetectedTech {
  id: string
  name: string
  /** 1 = named in a manifest; lower for file signatures and implied parents. */
  confidence: number
  /** Why we believe it: "package.json → next", "file go.mod", "implied by Next.js". */
  source: string
}

export interface ProjectStack {
  technologies: DetectedTech[]
  manifests: string[]
  files: number
  /** The walk stopped at MAX_FILES; detection saw part of the tree. */
  truncated: boolean
}

const SKIP = new Set([
  '.git',
  'node_modules',
  'vendor',
  'dist',
  'build',
  'out',
  'target',
  'coverage',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
  '.venv',
  'venv',
  '__pycache__',
  '.gradle',
  '.idea',
])
const MAX_DEPTH = 4
const MAX_FILES = 20_000
const MAX_MANIFEST_BYTES = 1_000_000

/**
 * Reads a local project's stack with the Oracle's signatures and weights, so `sigil mcp` and the
 * site agree on what a repo is. Reads file names and package manifests only; never runs anything.
 */
export async function detectStack(
  root: string,
  technologies: readonly Technology[],
): Promise<ProjectStack> {
  const { files, truncated } = await listFiles(root)
  const techs = new Map(technologies.map((t) => [t.id, t]))
  const found = new Map<string, DetectedTech>()
  const add = (id: string, confidence: number, source: string) => {
    const t = techs.get(id)
    if (!t) return
    const prev = found.get(id)
    if (!prev || prev.confidence < confidence)
      found.set(id, { id, name: t.name, confidence, source })
    // A framework implies its parent (nextjs → react), at lower confidence.
    if (t.parent && !found.has(t.parent) && techs.has(t.parent))
      found.set(t.parent, {
        id: t.parent,
        name: techs.get(t.parent)!.name,
        confidence: round(confidence * 0.7),
        source: `implied by ${t.name}`,
      })
  }

  for (const t of technologies) {
    for (const pattern of t.detect?.files ?? []) {
      const hit = matchFiles(pattern, files)
      if (hit) {
        add(t.id, hit.includes('/') ? 0.45 : 0.7, `file ${hit}`)
        break
      }
    }
  }

  const manifests = pickManifests(files)
  const index = packageIndex(technologies)
  for (const path of manifests) {
    const abs = join(root, ...path.split('/'))
    const st = await stat(abs).catch(() => undefined)
    if (!st?.isFile() || st.size > MAX_MANIFEST_BYTES) continue
    const text = await readFile(abs, 'utf8').catch(() => '')
    const eco = MANIFESTS[baseName(path)]!
    for (const pkg of packagesIn(baseName(path), text)) {
      for (const [key, id] of index.get(eco) ?? []) {
        if (matchesPackage(eco, pkg, key)) add(id, 1, `${path} → ${pkg}`)
      }
    }
  }

  return {
    technologies: [...found.values()].sort(
      (a, b) => b.confidence - a.confidence || a.id.localeCompare(b.id),
    ),
    manifests,
    files: files.length,
    truncated,
  }
}

const round = (n: number) => Math.round(n * 100) / 100

/** Breadth-first, so a cut-off walk still sees the shallow files that say the most. */
async function listFiles(root: string): Promise<{ files: string[]; truncated: boolean }> {
  const files: string[] = []
  let level = ['']
  for (let depth = 0; depth <= MAX_DEPTH && level.length; depth++) {
    const next: string[] = []
    for (const rel of level) {
      const entries = await readdir(join(root, rel), { withFileTypes: true }).catch(() => [])
      for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        const p = rel ? `${rel}/${e.name}` : e.name
        if (e.isDirectory()) {
          if (!SKIP.has(e.name)) next.push(p)
        } else if (e.isFile()) {
          files.push(p)
          if (files.length >= MAX_FILES) return { files, truncated: true }
        }
      }
    }
    level = next
  }
  return { files, truncated: false }
}
