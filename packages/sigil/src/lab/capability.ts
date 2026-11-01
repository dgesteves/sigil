import { join, resolve } from 'node:path'
import type { FileEntry } from '../core/digest.js'
import { findCapabilities, isDirectory, loadCapability } from '../core/load.js'
import type { Finding, Manifest } from '../core/schema.js'

export interface LabCapability {
  dir: string
  manifest: Manifest
  digest: `sha256:${string}`
  files: FileEntry[]
  namespace: string
  slug: string
  /** Structural findings from the core loader, recorded in the evidence's structure check. */
  findings: Finding[]
  /** First-party: hosted in this catalog. Third-party (`source` set) never runs on the host. */
  firstParty: boolean
}

export class CapabilityError extends Error {}

/**
 * Resolves `catalog/skills/x/y`, any directory with a sigil.yaml, or an id like `x/y`.
 * Refuses anything with blocking structural findings: we measure only well-formed content.
 */
export async function resolveCapability(
  target: string,
  cwd: string,
  opts: { root?: string; host?: boolean } = {},
): Promise<LabCapability> {
  const { root } = opts
  let dir = resolve(cwd, target)
  if (!(await isDirectory(dir))) {
    if (!root || !/^[a-z0-9-]+\/[a-z0-9-]+$/.test(target)) {
      throw new CapabilityError(`no capability at ${target}`)
    }
    const dirs = await findCapabilities(join(root, 'catalog'))
    const loaded = await Promise.all(dirs.map((d) => loadCapability(d, { root })))
    const match = loaded.find((l) => l.manifest?.id === target)
    if (!match) throw new CapabilityError(`no capability with id ${target} in ${root}/catalog`)
    dir = match.dir
  }
  const loaded = await loadCapability(dir, root ? { root } : {})
  const blocking = loaded.findings.filter((f) => f.severity === 'high' || f.severity === 'critical')
  if (!loaded.manifest || blocking.length > 0) {
    const why = blocking.map((f) => f.message).join('; ') || 'invalid sigil.yaml'
    throw new CapabilityError(`${target} is not a valid capability: ${why}`)
  }
  if (loaded.manifest.source && opts.host) {
    throw new CapabilityError(
      `${loaded.manifest.id} is a third-party capability (it has a source). Third-party content never runs on the host; drop --host to use the Docker sandbox.`,
    )
  }
  if (!loaded.digest) {
    throw new CapabilityError(
      loaded.manifest.source
        ? `${loaded.manifest.id} is hosted upstream; fetch it at the pinned commit before proving it (the lab never fetches during a run)`
        : `${target} has no payload files`,
    )
  }
  const [namespace, slug] = loaded.manifest.id.split('/') as [string, string]
  return {
    dir,
    manifest: loaded.manifest,
    digest: loaded.digest,
    files: loaded.files,
    namespace,
    slug,
    findings: loaded.findings,
    firstParty: !loaded.manifest.source,
  }
}
