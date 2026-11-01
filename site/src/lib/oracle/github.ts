/**
 * Reads a public GitHub repo's stack from the browser. Two API calls (repo, tree) and a few raw
 * file reads, which do not count against the unauthenticated 60-requests-an-hour limit. Detection
 * uses the signatures in taxonomy/technologies.yaml, so the Oracle and the catalog share one vocabulary.
 */
import { addTech, emptySignals, type Signals, type Tech } from './intent'

export interface FetchLog {
  url: string
  label: string
  status: number | 'error'
  ms: number
  bytes?: number
  note?: string
}

export class RateLimited extends Error {
  constructor(public resetAt: Date | null) {
    super('GitHub rate limit reached')
  }
}

export interface RepoRead {
  owner: string
  repo: string
  branch: string
  description: string | null
  language: string | null
  topics: string[]
  paths: number
  truncated: boolean
  manifests: string[]
  signals: Signals
}

const MANIFESTS: Record<string, string> = {
  'package.json': 'npm',
  'requirements.txt': 'pypi',
  'requirements-dev.txt': 'pypi',
  'pyproject.toml': 'pypi',
  Pipfile: 'pypi',
  'Cargo.toml': 'cargo',
  'go.mod': 'go',
  'pom.xml': 'maven',
  'build.gradle': 'maven',
  'build.gradle.kts': 'maven',
  'composer.json': 'composer',
  Gemfile: 'gem',
  'pubspec.yaml': 'pub',
  'mix.exs': 'hex',
}
const MAX_MANIFESTS = 8

export async function readRepo(
  owner: string,
  repo: string,
  techs: Map<string, Tech>,
  log: (l: FetchLog) => void,
  signal: AbortSignal,
): Promise<RepoRead> {
  const api = `https://api.github.com/repos/${owner}/${repo}`
  const meta = await getJson<{
    default_branch: string
    description: string | null
    language: string | null
    topics?: string[]
    private?: boolean
  }>(api, 'repository', log, signal)
  const branch = meta.default_branch
  const tree = await getJson<{ tree: { path: string; type: string }[]; truncated: boolean }>(
    `${api}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
    'file tree',
    log,
    signal,
  )
  const files = tree.tree.filter((t) => t.type === 'blob').map((t) => t.path)
  const s = emptySignals()

  // 1. File signatures: paths and simple globs from the taxonomy.
  for (const t of techs.values()) {
    for (const pattern of t.detect?.files ?? []) {
      const hit = matchFiles(pattern, files)
      if (hit) {
        const depth = hit.split('/').length - 1
        addTech(s, techs, t.id, { weight: depth === 0 ? 0.7 : 0.45, source: `file ${hit}` })
        break
      }
    }
  }

  // 2. Package manifests, root first, then the shallowest nested ones (monorepos).
  const manifests = files
    .filter(
      (p) =>
        MANIFESTS[base(p)] &&
        !/(^|\/)(node_modules|vendor|dist|build|\.venv|examples?|fixtures|test|tests)\//.test(p),
    )
    .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))
    .slice(0, MAX_MANIFESTS)
  const index = packageIndex(techs)
  await Promise.all(
    manifests.map(async (path) => {
      const url = `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/${path.split('/').map(encodeURIComponent).join('/')}`
      const text = await getText(url, path, log, signal)
      if (text === null) return
      const eco = MANIFESTS[base(path)]!
      for (const pkg of packagesIn(base(path), text)) {
        for (const [key, id] of index.get(eco) ?? []) {
          if (
            pkg === key ||
            (eco === 'maven' && pkg.startsWith(key)) ||
            (eco === 'go' && pkg.startsWith(key))
          ) {
            addTech(s, techs, id, { weight: 1, source: `${path} → ${pkg}` })
          }
        }
      }
    }),
  )

  // 3. What GitHub itself says.
  const lang = meta.language?.toLowerCase()
  const langId = lang === 'c#' ? 'csharp' : lang === 'c++' ? 'cpp' : lang
  if (langId && techs.has(langId))
    addTech(s, techs, langId, { weight: 0.8, source: 'GitHub language' })
  for (const topic of meta.topics ?? []) {
    if (techs.has(topic)) addTech(s, techs, topic, { weight: 0.7, source: `topic ${topic}` })
  }
  s.terms.push(...(meta.topics ?? []))

  return {
    owner,
    repo,
    branch,
    description: meta.description,
    language: meta.language,
    topics: meta.topics ?? [],
    paths: files.length,
    truncated: tree.truncated,
    manifests,
    signals: s,
  }
}

function base(p: string) {
  return p.slice(p.lastIndexOf('/') + 1)
}

function packageIndex(techs: Map<string, Tech>): Map<string, [string, string][]> {
  const out = new Map<string, [string, string][]>()
  for (const t of techs.values()) {
    for (const [eco, pkgs] of Object.entries(t.detect ?? {})) {
      if (eco === 'files' || !pkgs) continue
      const list = out.get(eco) ?? []
      for (const p of pkgs) list.push([eco === 'pypi' ? normPy(p) : p, t.id])
      out.set(eco, list)
    }
  }
  return out
}

const normPy = (n: string) => n.toLowerCase().replace(/[-_.]+/g, '-')

/** Dependency names from a manifest. Tolerant on purpose: a missed package is better than a crash. */
export function packagesIn(file: string, text: string): string[] {
  try {
    if (file === 'package.json' || file === 'composer.json') {
      const j = JSON.parse(text) as Record<string, Record<string, string> | undefined>
      const keys =
        file === 'package.json'
          ? ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']
          : ['require', 'require-dev']
      return keys.flatMap((k) => Object.keys(j[k] ?? {}))
    }
  } catch {
    return []
  }
  if (file.startsWith('requirements')) {
    return text
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#') && !l.startsWith('-'))
      .map((l) => normPy(l.split(/[<>=!~;[\s]/)[0]!))
  }
  if (file === 'pyproject.toml' || file === 'Pipfile') {
    const names = new Set<string>()
    for (const m of text.matchAll(
      /["']([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[^\]]*\])?\s*(?:[<>=!~;][^"']*)?["']/g,
    ))
      names.add(normPy(m[1]!))
    for (const m of text.matchAll(/^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*=\s*(?:["'{])/gm))
      names.add(normPy(m[1]!))
    return [...names]
  }
  if (file === 'Cargo.toml') {
    const names: string[] = []
    let inDeps = false
    for (const line of text.split('\n')) {
      const sec = /^\s*\[([^\]]+)\]/.exec(line)
      if (sec) {
        inDeps = /dependencies/.test(sec[1]!)
        const inline = /dependencies\.([A-Za-z0-9_-]+)/.exec(sec[1]!)
        if (inline) names.push(inline[1]!)
        continue
      }
      const m = /^\s*([A-Za-z0-9_-]+)\s*=/.exec(line)
      if (inDeps && m) names.push(m[1]!)
    }
    return names
  }
  if (file === 'go.mod')
    return [...text.matchAll(/^\s*(?:require\s+)?([a-z0-9.-]+\.[a-z]{2,}\/[^\s]+)\s+v/gm)].map(
      (m) => m[1]!,
    )
  if (file === 'pom.xml')
    return [
      ...text.matchAll(/<groupId>([^<]+)<\/groupId>\s*<artifactId>([^<]+)<\/artifactId>/g),
    ].map((m) => `${m[1]}:${m[2]}`)
  if (file.startsWith('build.gradle'))
    return [...text.matchAll(/["']([a-zA-Z0-9_.-]+:[a-zA-Z0-9_.-]+)(?::[^"']*)?["']/g)].map(
      (m) => m[1]!,
    )
  if (file === 'Gemfile')
    return [...text.matchAll(/^\s*gem\s+["']([^"']+)["']/gm)].map((m) => m[1]!)
  if (file === 'pubspec.yaml') return [...text.matchAll(/^\s{2}([a-z0-9_]+):/gm)].map((m) => m[1]!)
  if (file === 'mix.exs') return [...text.matchAll(/\{:([a-z0-9_]+),/g)].map((m) => m[1]!)
  return []
}

/** `*` matches inside one path segment. Patterns without a slash match a file name at any depth. */
export function matchFiles(pattern: string, files: readonly string[]): string | undefined {
  const re = new RegExp(`^${pattern.split('*').map(escapeRe).join('[^/]*')}$`)
  if (pattern.includes('/')) return files.find((f) => re.test(f))
  return files.find((f) => re.test(base(f)) && f.split('/').length <= 3)
}

const escapeRe = (s: string) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')

async function getJson<T>(
  url: string,
  label: string,
  log: (l: FetchLog) => void,
  signal: AbortSignal,
): Promise<T> {
  const t0 = performance.now()
  let res: Response
  try {
    res = await fetch(url, { signal, headers: { Accept: 'application/vnd.github+json' } })
  } catch (e) {
    log({ url, label, status: 'error', ms: performance.now() - t0, note: (e as Error).message })
    throw e
  }
  const text = await res.text()
  log({ url, label, status: res.status, ms: performance.now() - t0, bytes: text.length })
  if (
    (res.status === 403 || res.status === 429) &&
    res.headers.get('x-ratelimit-remaining') === '0'
  ) {
    const reset = Number(res.headers.get('x-ratelimit-reset'))
    throw new RateLimited(Number.isFinite(reset) && reset > 0 ? new Date(reset * 1000) : null)
  }
  if (res.status === 404)
    throw new Error('not found, or private (only public repos can be read without signing in)')
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`)
  return JSON.parse(text) as T
}

async function getText(
  url: string,
  label: string,
  log: (l: FetchLog) => void,
  signal: AbortSignal,
): Promise<string | null> {
  const t0 = performance.now()
  try {
    const res = await fetch(url, { signal })
    const text = res.ok ? await res.text() : ''
    log({ url, label, status: res.status, ms: performance.now() - t0, bytes: text.length })
    return res.ok ? text : null
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    log({ url, label, status: 'error', ms: performance.now() - t0, note: (e as Error).message })
    return null
  }
}
