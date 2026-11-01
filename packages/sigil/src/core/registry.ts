import { readFile } from 'node:fs/promises'
import { join, posix, relative, sep } from 'node:path'
import { levelOf, upliftOf } from './level.js'
import { findCapabilities, loadCapability } from './load.js'
import { Evidence, type Finding, type Registry, type RegistryEntry } from './schema.js'

export interface BuildResult {
  registry: Registry
  /** Capabilities that failed structural validation, with their findings. They are left out. */
  rejected: { path: string; findings: Finding[] }[]
}

/**
 * Builds the registry from the catalog. The registry is a pure function of the repo:
 * same commit in, same JSON out (apart from generatedAt).
 */
export async function buildRegistry(
  root: string,
  opts: { commit?: string; now?: Date } = {},
): Promise<BuildResult> {
  const dirs = await findCapabilities(join(root, 'catalog'))
  const capabilities: RegistryEntry[] = []
  const rejected: BuildResult['rejected'] = []
  const seen = new Map<string, string>()

  for (const dir of dirs) {
    const path = relative(root, dir).split(sep).join(posix.sep)
    const loaded = await loadCapability(dir, { root })
    const blocking = loaded.findings.filter(
      (f) => f.severity === 'high' || f.severity === 'critical',
    )
    if (!loaded.manifest || blocking.length > 0) {
      rejected.push({ path, findings: loaded.findings })
      continue
    }
    const prior = seen.get(loaded.manifest.id)
    if (prior) {
      rejected.push({
        path,
        findings: [
          {
            rule: 'SIG-STR-014',
            severity: 'high',
            message: `duplicate id ${loaded.manifest.id} (also at ${prior})`,
          },
        ],
      })
      continue
    }
    seen.set(loaded.manifest.id, path)

    const evidence = await readEvidence(dir)
    const digest = loaded.digest ?? evidence?.digest
    if (!digest) {
      // External capability that has never been fetched and hashed: listed, nothing more.
      rejected.push({
        path,
        findings: [
          {
            rule: 'SIG-STR-018',
            severity: 'medium',
            message: 'external capability has no evidence yet (run sigil fetch)',
          },
        ],
      })
      continue
    }
    capabilities.push({
      manifest: loaded.manifest,
      digest: digest as `sha256:${string}`,
      path,
      level: levelOf({ digest, evidence }),
      uplift: upliftOf(evidence, digest),
      ...(evidence ? { evidence } : {}),
      files: loaded.files,
    })
  }

  capabilities.sort((a, b) => a.manifest.id.localeCompare(b.manifest.id))
  return {
    registry: {
      sigil: 1,
      generatedAt: (opts.now ?? new Date()).toISOString(),
      ...(opts.commit ? { commit: opts.commit } : {}),
      capabilities,
    },
    rejected,
  }
}

async function readEvidence(dir: string): Promise<Evidence | undefined> {
  let raw: string
  try {
    raw = await readFile(join(dir, 'evidence.json'), 'utf8')
  } catch {
    return undefined
  }
  return Evidence.parse(JSON.parse(raw))
}
