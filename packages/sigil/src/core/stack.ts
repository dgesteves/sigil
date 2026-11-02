/**
 * Stack detection shared by the CLI and the Oracle. Pure on purpose: callers list the files and read
 * the manifests, so the same code runs in Node (`sigil mcp`) and in the browser (the site's Oracle).
 * Signatures come from taxonomy/technologies.yaml, so detection and the catalog share one vocabulary.
 */

/** Package manifests and the ecosystem whose package names they list. */
export const MANIFESTS: Record<string, string> = {
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

/** The detection part of a taxonomy entry. */
export interface TechSignature {
  id: string
  parent?: string | undefined
  detect?: Record<string, readonly string[] | undefined> | undefined
}

export const baseName = (p: string) => p.slice(p.lastIndexOf('/') + 1)

const VENDORED = /(^|\/)(node_modules|vendor|dist|build|\.venv|examples?|fixtures|test|tests)\//

/** Manifests worth reading: root first, then the shallowest nested ones (monorepos). */
export function pickManifests(files: readonly string[], max = 8): string[] {
  return files
    .filter((p) => MANIFESTS[baseName(p)] && !VENDORED.test(p))
    .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))
    .slice(0, max)
}

/** ecosystem → [package key, technology id] pairs from the taxonomy's signatures. */
export function packageIndex(techs: Iterable<TechSignature>): Map<string, [string, string][]> {
  const out = new Map<string, [string, string][]>()
  for (const t of techs) {
    for (const [eco, pkgs] of Object.entries(t.detect ?? {})) {
      if (eco === 'files' || !pkgs) continue
      const list = out.get(eco) ?? []
      for (const p of pkgs) list.push([eco === 'pypi' ? normPy(p) : p, t.id])
      out.set(eco, list)
    }
  }
  return out
}

/** Maven coordinates and Go modules match by prefix (a group, a module path); the rest exactly. */
export function matchesPackage(eco: string, pkg: string, key: string): boolean {
  return pkg === key || ((eco === 'maven' || eco === 'go') && pkg.startsWith(key))
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
    // Bounded, and never past a quote or a line end: a crafted manifest must not make these
    // quadratic (`recommend` reads whatever project the agent is in).
    for (const m of text.matchAll(
      /["']([A-Za-z0-9][A-Za-z0-9._-]{0,99})(?:\[[^\]"'\n]{0,99}\])?[ \t]{0,9}(?:[<>=!~;][^"'\n]{0,199})?["']/g,
    ))
      names.add(normPy(m[1]!))
    for (const m of text.matchAll(
      /^[ \t]{0,20}([A-Za-z0-9][A-Za-z0-9._-]{0,99})[ \t]{0,9}=[ \t]{0,9}["'{]/gm,
    ))
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
  return files.find((f) => re.test(baseName(f)) && f.split('/').length <= 3)
}

const escapeRe = (s: string) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
