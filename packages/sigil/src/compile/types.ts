import type { AgentId, PayloadFormat } from '../core/ids.js'
import type { Manifest } from '../core/schema.js'

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue }

export interface PayloadFile {
  /** POSIX path relative to the capability root. */
  path: string
  content: Buffer
}

/** A capability whose payload is in memory and has been checked against its digest. */
export interface CapabilityInput {
  manifest: Manifest
  digest: `sha256:${string}`
  files: PayloadFile[]
}

/* ------------------------------------------------------------------------------------------------
 * Write plan. Adapters return these; the installer applies them and records how to undo them.
 * Paths are POSIX and relative to the project root.
 * ---------------------------------------------------------------------------------------------- */

/** A whole file owned by the capability. */
export interface FileOp {
  kind: 'file'
  path: string
  content: Buffer
  /** 0o644, or 0o755 for a script a hook runs directly. Setting the bit is not executing it. */
  mode: number
}

/**
 * A non-destructive edit inside a shared JSON settings file. `set` adds an object key that must not
 * exist yet; `append` adds one array element. Both are undone exactly by the lockfile.
 */
export interface JsonOp {
  kind: 'json'
  path: string
  op: 'set' | 'append'
  pointer: string[]
  value: JsonValue
}

/** A marked block appended to a shared text file (AGENTS.md, GEMINI.md, config.toml). */
export interface BlockOp {
  kind: 'block'
  path: string
  syntax: 'markdown' | 'toml'
  /** The capability id; it names the block markers. */
  id: string
  content: string
}

export type WriteOp = FileOp | JsonOp | BlockOp

export interface Note {
  level: 'info' | 'warn'
  message: string
}

export interface Supported {
  status: 'supported'
  ops: WriteOp[]
  notes: Note[]
}

export interface Unsupported {
  status: 'unsupported'
  reason: string
}

export type AdapterResult = Supported | Unsupported

export interface CompileContext {
  /** Picks one of the agent's documented locations, preferring one another target already writes. */
  pickDir(candidates: readonly string[]): string
  /** Whether a path exists in the target project (always false for `sigil export`). */
  exists(path: string): boolean
}

/** One documented (format, agent) mapping. */
export interface Adapter {
  format: PayloadFormat
  agent: AgentId
  /** Where it writes, with `<slug>` for the capability slug. Shown in docs and `sigil init`. */
  target: string
  /** Official documentation the mapping is based on. */
  sources: readonly string[]
  compile(cap: CapabilityInput, ctx: CompileContext): AdapterResult
}

/** A combination that was researched and is not supported, with the reason and the evidence. */
export interface KnownGap {
  format: PayloadFormat
  agent: AgentId
  reason: string
  sources?: readonly string[]
}

export const ok = (ops: WriteOp[], notes: Note[] = []): Supported => ({
  status: 'supported',
  ops,
  notes,
})
export const no = (reason: string): Unsupported => ({ status: 'unsupported', reason })
export const info = (message: string): Note => ({ level: 'info', message })
export const warn = (message: string): Note => ({ level: 'warn', message })

export function slugOf(cap: CapabilityInput): string {
  return cap.manifest.id.split('/')[1]!
}

export function entryText(cap: CapabilityInput): string {
  const entry = cap.files.find((f) => f.path === cap.manifest.payload.entry)
  if (!entry) throw new Error(`payload entry ${cap.manifest.payload.entry} is missing`)
  return entry.content.toString('utf8')
}

export function fileOp(path: string, content: Buffer | string, mode = 0o644): FileOp {
  return {
    kind: 'file',
    path,
    content: typeof content === 'string' ? Buffer.from(content, 'utf8') : content,
    mode,
  }
}
