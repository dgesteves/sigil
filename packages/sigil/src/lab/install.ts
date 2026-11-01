import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { sha256Hex } from '../core/digest.js'
import type { LabCapability } from './capability.js'

/**
 * Reads the payload exactly as it was digested, and refuses if any byte changed since loading:
 * the lab must install the content its evidence will be bound to, nothing else.
 */
export async function readPayload(
  capability: LabCapability,
): Promise<{ path: string; content: Buffer }[]> {
  const out: { path: string; content: Buffer }[] = []
  for (const f of capability.files) {
    const content = await readFile(join(capability.dir, f.path))
    if (sha256Hex(content) !== f.sha256) {
      throw new Error(
        `${f.path} changed after the capability was loaded; re-run to bind to the new digest`,
      )
    }
    out.push({ path: f.path, content })
  }
  return out
}
