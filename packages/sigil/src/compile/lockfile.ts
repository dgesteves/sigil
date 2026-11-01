import { z } from 'zod'
import { LEVELS, UPLIFT_VERDICTS } from '../core/ids.js'
import {
  AgentIdSchema,
  CapabilityId,
  CapabilityTypeSchema,
  Digest,
  GitSha,
  SemVer,
} from '../core/schema.js'
import type { JsonValue } from './types.js'
import { safeRelative, type Workspace } from './workspace.js'

/**
 * `sigil.lock.json`: what Sigil wrote into this project and how to take it out again. It records
 * hashes and the exact merged values, never the previous contents of user files, so it is safe to
 * commit: settings files can hold secrets, and a lockfile must not copy them.
 */
export const LOCKFILE = 'sigil.lock.json'

const RelPath = z.string().refine((p) => {
  try {
    return safeRelative(p) === p
  } catch {
    return false
  }
}, 'expected a normalised project-relative path')

const Json: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number(),
    z.string(),
    z.array(Json),
    z.record(z.string(), Json),
  ]),
)

export const LockSource = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('registry'),
    /** The registry URL or path it was resolved from. */
    registry: z.string(),
    /** Commit the payload was fetched at; absent for a local Sigil checkout. */
    commit: GitSha.optional(),
  }),
  z.strictObject({ kind: z.literal('path'), path: z.string() }),
])
export type LockSource = z.infer<typeof LockSource>

export const LockedFile = z.strictObject({
  path: RelPath,
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  agents: z.array(AgentIdSchema).min(1),
  /** The identical file was already there; removal leaves it. */
  preexisting: z.boolean().default(false),
})
export type LockedFile = z.infer<typeof LockedFile>

export const LockedMerge = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('json'),
    path: RelPath,
    op: z.enum(['set', 'append']),
    pointer: z.array(z.string()).min(1),
    value: Json,
    agents: z.array(AgentIdSchema).min(1),
    /** Sigil created the file; removal deletes it once nothing else is left in it. */
    createdFile: z.boolean().default(false),
    /** Objects and arrays Sigil created to hold the value; pruned on removal when empty. */
    createdContainers: z.array(z.array(z.string())).default([]),
    adopted: z.boolean().default(false),
  }),
  z.strictObject({
    kind: z.literal('block'),
    path: RelPath,
    syntax: z.enum(['markdown', 'toml']),
    id: CapabilityId,
    /** The exact text inserted, separators included. */
    inserted: z.string(),
    agents: z.array(AgentIdSchema).min(1),
    createdFile: z.boolean().default(false),
  }),
])
export type LockedMerge = z.infer<typeof LockedMerge>

export const LockEntry = z.strictObject({
  version: SemVer,
  type: CapabilityTypeSchema,
  digest: Digest,
  source: LockSource,
  /** Trust level and uplift verdict at install time, from the registry. Absent for local paths. */
  level: z.enum(LEVELS).optional(),
  uplift: z.enum(UPLIFT_VERDICTS).optional(),
  /** Set when the capability was installed as a member of a collection. */
  via: CapabilityId.optional(),
  agents: z.array(AgentIdSchema).min(1),
  installedAt: z.iso.datetime(),
  files: z.array(LockedFile).default([]),
  merges: z.array(LockedMerge).default([]),
  /** Directories the install created; removed again when empty. */
  dirs: z.array(RelPath).default([]),
})
export type LockEntry = z.infer<typeof LockEntry>

export const LockFile = z.strictObject({
  sigil: z.literal(1),
  /** Agents chosen with `sigil init`; `sigil add` targets them by default. */
  agents: z.array(AgentIdSchema).optional(),
  capabilities: z.record(CapabilityId, LockEntry).default({}),
})
export type LockFile = z.infer<typeof LockFile>

export class LockfileError extends Error {}

export async function readLock(ws: Workspace): Promise<LockFile | undefined> {
  const buf = await ws.read(LOCKFILE)
  if (!buf) return undefined
  let json: unknown
  try {
    json = JSON.parse(buf.toString('utf8'))
  } catch {
    throw new LockfileError(`${LOCKFILE} is not valid JSON`)
  }
  const parsed = LockFile.safeParse(json)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!
    throw new LockfileError(`${LOCKFILE}: ${issue.path.join('.') || '(root)'}: ${issue.message}`)
  }
  return parsed.data
}

export function serializeLock(lock: LockFile): Buffer {
  const capabilities = Object.fromEntries(
    Object.entries(lock.capabilities).sort(([a], [b]) => a.localeCompare(b)),
  )
  const out = { sigil: 1, ...(lock.agents ? { agents: lock.agents } : {}), capabilities }
  return Buffer.from(`${JSON.stringify(out, null, 2)}\n`, 'utf8')
}

/** Writes the lockfile, or deletes it when it holds nothing (so add + remove leaves no trace). */
export async function writeLock(ws: Workspace, lock: LockFile): Promise<void> {
  if (!lock.agents && Object.keys(lock.capabilities).length === 0) await ws.delete(LOCKFILE)
  else await ws.write(LOCKFILE, serializeLock(lock))
}
