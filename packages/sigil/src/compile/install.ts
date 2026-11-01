import { posix } from 'node:path'
import { sha256Hex } from '../core/digest.js'
import type { Level, UpliftVerdict } from '../core/ids.js'
import type { CompileResult } from './compile.js'
import {
  LOCKFILE,
  type LockEntry,
  type LockedFile,
  type LockedMerge,
  type LockFile,
  type LockSource,
  readLock,
  writeLock,
} from './lockfile.js'
import {
  appendBlock,
  applyAppend,
  applySet,
  blockStatus,
  hasBlock,
  MergeError,
  mergeStatus,
  parseJsonDoc,
  pruneContainers,
  removeBlock,
  revert,
  serializeJson,
  tomlConflicts,
} from './merge.js'
import type { JsonValue } from './types.js'
import { PathError, Workspace } from './workspace.js'

/**
 * A session stages installs and removals against one project. Conflicts accumulate instead of
 * throwing, so the user sees every problem at once; nothing is written unless there are none.
 */
export class Session {
  readonly conflicts: string[] = []
  private readonly noteSet = new Set<string>()
  private readonly prunes = new Set<string>()

  constructor(
    readonly ws: Workspace,
    readonly lock: LockFile,
    readonly force: boolean,
  ) {}

  get notes(): string[] {
    return [...this.noteSet]
  }
  note(message: string): void {
    this.noteSet.add(message)
  }
  conflict(message: string): void {
    this.conflicts.push(message)
  }
  schedulePrune(dir: string): void {
    this.prunes.add(dir)
  }
  /** A directory scheduled for pruning is reused by a later install: keep it. */
  claimPruned(dir: string): boolean {
    return this.prunes.delete(dir)
  }

  /** Stages the lockfile and returns the full change set for the preview. */
  async finish(): Promise<ReturnType<Workspace['changes']>> {
    for (const d of this.prunes) this.ws.pruneDir(d)
    await writeLock(this.ws, this.lock)
    return this.ws.changes()
  }

  async commit(): Promise<void> {
    if (this.conflicts.length) throw new Error('refusing to commit a session with conflicts')
    await this.ws.commit()
  }
}

export async function openSession(root: string, force = false): Promise<Session> {
  const ws = new Workspace(root)
  const lock = (await readLock(ws)) ?? { sigil: 1, capabilities: {} }
  return new Session(ws, lock, force)
}

export interface InstallRequest {
  compiled: CompileResult
  source: LockSource
  level?: Level
  uplift?: UpliftVerdict
  via?: string
  now?: Date
}

const errorMessage = (e: unknown) => {
  if (e instanceof MergeError || e instanceof PathError) return e.message
  throw e
}

function nested(pointer: string[], value: JsonValue): JsonValue {
  return pointer.reduceRight<JsonValue>((acc, key) => ({ [key]: acc }), value)
}

function others(lock: LockFile, id: string): [string, LockEntry][] {
  return Object.entries(lock.capabilities).filter(([other]) => other !== id)
}

function fileOwner(lock: LockFile, id: string, path: string): string | undefined {
  return others(lock, id).find(([, e]) =>
    e.files.some((f) => f.path === path && !f.preexisting),
  )?.[0]
}

function mergeOwner(lock: LockFile, id: string, path: string): string | undefined {
  return others(lock, id).find(([, e]) => e.merges.some((m) => m.path === path))?.[0]
}

const under = (path: string, dir: string) => path.startsWith(`${dir}/`)

export async function stageInstall(s: Session, req: InstallRequest): Promise<void> {
  const cap = req.compiled.capability
  const id = cap.manifest.id
  if (s.lock.capabilities[id]) await stageRemove(s, id)

  const files: LockedFile[] = []
  const merges: LockedMerge[] = []
  const created: string[] = []

  for (const { op, agents } of req.compiled.ops) {
    if (op.path === LOCKFILE) {
      s.conflict(`${id} tries to write ${LOCKFILE}`)
      continue
    }
    try {
      if (op.kind === 'file') {
        const owner = fileOwner(s.lock, id, op.path) ?? mergeOwner(s.lock, id, op.path)
        if (owner) {
          s.conflict(`${op.path} is already installed by ${owner}`)
          continue
        }
        const current = await s.ws.read(op.path)
        if (current && !current.equals(op.content)) {
          s.conflict(`${op.path} already exists and was not written by Sigil; move it away first`)
          continue
        }
        if (!current) {
          await s.ws.write(op.path, op.content, op.mode)
          created.push(op.path)
        } else {
          s.note(`${op.path} already has identical content; it is kept on removal`)
        }
        files.push({ path: op.path, sha256: sha256Hex(op.content), agents, preexisting: !!current })
        continue
      }

      const owner = fileOwner(s.lock, id, op.path)
      if (owner) {
        s.conflict(`${op.path} is a file installed by ${owner}`)
        continue
      }
      const before = await s.ws.read(op.path)
      if (!before) created.push(op.path)

      if (op.kind === 'json') {
        const doc = parseJsonDoc(before, op.path)
        if (doc.reformatted)
          s.note(`${op.path} will be rewritten with ${JSON.stringify(doc.indent)} JSON indentation`)
        const r =
          op.op === 'set'
            ? applySet(doc, op.pointer, op.value, op.path)
            : applyAppend(doc, op.pointer, op.value, op.path)
        await s.ws.write(op.path, serializeJson(doc))
        merges.push({
          kind: 'json',
          path: op.path,
          op: op.op,
          pointer: op.pointer,
          value: op.value,
          agents,
          createdFile: before === undefined,
          createdContainers: r.createdContainers,
          adopted: r.adopted,
        })
        continue
      }

      const text = before?.toString('utf8')
      if (text && hasBlock(text, op.syntax, op.id)) {
        s.conflict(
          `${op.path} already has a Sigil block for ${op.id} that ${LOCKFILE} does not record`,
        )
        continue
      }
      const clash = op.syntax === 'toml' && text ? tomlConflicts(text, op.content) : []
      if (clash.length) {
        s.conflict(`${op.path} already defines [${clash.join('], [')}]`)
        continue
      }
      const r = appendBlock(text, op.syntax, op.id, op.content)
      await s.ws.write(op.path, Buffer.from(r.text, 'utf8'))
      merges.push({
        kind: 'block',
        path: op.path,
        syntax: op.syntax,
        id: op.id,
        inserted: r.inserted,
        agents,
        createdFile: before === undefined,
      })
    } catch (e) {
      const message = errorMessage(e)
      s.conflict(
        op.kind === 'json'
          ? `${message}. Add this by hand: ${JSON.stringify(nested(op.pointer, op.value))}`
          : message,
      )
    }
  }

  const dirs: string[] = []
  const claimed = new Set(Object.values(s.lock.capabilities).flatMap((e) => e.dirs))
  for (const path of created) {
    for (let d = posix.dirname(path); d !== '.'; d = posix.dirname(d)) {
      if (dirs.includes(d) || claimed.has(d)) break
      if (s.claimPruned(d) || !(await s.ws.dirExists(d))) dirs.push(d)
      else break
    }
  }

  const agents = req.compiled.results
    .filter((r) => r.result.status === 'supported')
    .map((r) => r.agent)
  s.lock.capabilities[id] = {
    version: cap.manifest.version,
    type: cap.manifest.type,
    digest: cap.digest,
    source: req.source,
    ...(req.level ? { level: req.level } : {}),
    ...(req.uplift ? { uplift: req.uplift } : {}),
    ...(req.via ? { via: req.via } : {}),
    agents,
    installedAt: (req.now ?? new Date()).toISOString(),
    files,
    merges,
    dirs: dirs.sort(),
  }
}

export async function stageRemove(s: Session, id: string): Promise<void> {
  const entry = s.lock.capabilities[id]
  if (!entry) {
    s.conflict(`${id} is not installed`)
    return
  }

  for (const f of entry.files) {
    if (f.preexisting) continue
    const current = await s.ws.read(f.path)
    if (!current) {
      s.note(`${f.path} was already deleted`)
      continue
    }
    if (sha256Hex(current) !== f.sha256) {
      if (!s.force) {
        s.conflict(`${f.path} was changed after install; re-run with --force to remove it anyway`)
        continue
      }
      s.note(`removing ${f.path} although it was changed after install (--force)`)
    }
    await s.ws.delete(f.path)
  }

  for (const m of [...entry.merges].reverse()) {
    try {
      const before = await s.ws.read(m.path)
      if (!before) {
        s.note(`${m.path} no longer exists`)
        continue
      }
      let empty: boolean
      let after: Buffer
      if (m.kind === 'json') {
        const doc = parseJsonDoc(before, m.path)
        if (!m.adopted) {
          const status = revert(doc, m.op, m.pointer, m.value, s.force)
          if (status === 'modified') {
            s.conflict(
              `${m.path}: ${m.pointer.join('.')} was changed after install; re-run with --force to remove it anyway`,
            )
            continue
          }
          if (status === 'missing') s.note(`${m.path}: ${m.pointer.join('.')} was already removed`)
        }
        for (const kept of pruneContainers(doc, m.createdContainers))
          inherit(s, id, m.path, (x) => {
            if (x.kind === 'json' && kept.every((k, i) => x.pointer[i] === k)) {
              x.createdContainers.push(kept)
              return true
            }
            return false
          })
        empty = Object.keys(doc.value).length === 0
        after = serializeJson(doc)
      } else {
        const r = removeBlock(before.toString('utf8'), m.syntax, m.id, m.inserted, s.force)
        if (r.status === 'modified') {
          s.conflict(
            `${m.path}: the ${m.id} block was changed after install; re-run with --force to remove it anyway`,
          )
          continue
        }
        if (r.status === 'missing') s.note(`${m.path}: the ${m.id} block was already removed`)
        empty = r.text === ''
        after = Buffer.from(r.text, 'utf8')
      }
      if (m.createdFile && empty && !mergeOwner(s.lock, id, m.path)) {
        await s.ws.delete(m.path)
      } else {
        await s.ws.write(m.path, after)
        if (m.createdFile)
          inherit(s, id, m.path, (x) => {
            x.createdFile = true
            return true
          })
      }
    } catch (e) {
      s.conflict(errorMessage(e))
    }
  }

  for (const d of entry.dirs) {
    const heir = others(s.lock, id).find(
      ([, e]) => e.files.some((f) => under(f.path, d)) || e.merges.some((m) => under(m.path, d)),
    )
    if (heir) heir[1].dirs = [...new Set([...heir[1].dirs, d])].sort()
    else s.schedulePrune(d)
  }
  delete s.lock.capabilities[id]
}

/** Hands something this capability created (a file, a container) to another one that still uses it. */
function inherit(s: Session, id: string, path: string, take: (m: LockedMerge) => boolean): void {
  for (const [, e] of others(s.lock, id))
    for (const m of e.merges) if (m.path === path && take(m)) return
}

/* ------------------------------------------------------------------------------------------------
 * Drift: what changed since install. Used by `sigil list` and to explain refusals.
 * ---------------------------------------------------------------------------------------------- */

export type State = 'ok' | 'modified' | 'missing' | 'preexisting'

export interface EntryStatus {
  id: string
  entry: LockEntry
  items: { path: string; what: string; state: State }[]
}

export async function inspect(ws: Workspace, lock: LockFile): Promise<EntryStatus[]> {
  const out: EntryStatus[] = []
  for (const [id, entry] of Object.entries(lock.capabilities).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const items: EntryStatus['items'] = []
    for (const f of entry.files) {
      const current = await ws.read(f.path)
      const state: State = f.preexisting
        ? 'preexisting'
        : !current
          ? 'missing'
          : sha256Hex(current) === f.sha256
            ? 'ok'
            : 'modified'
      items.push({ path: f.path, what: 'file', state })
    }
    for (const m of entry.merges) {
      const current = await ws.read(m.path)
      let state: State
      if (m.kind === 'json') {
        try {
          state = current
            ? mergeStatus(parseJsonDoc(current, m.path), m.op, m.pointer, m.value)
            : 'missing'
        } catch {
          state = 'modified'
        }
        items.push({ path: m.path, what: m.pointer.join('.'), state })
      } else {
        state = blockStatus(current?.toString('utf8'), m.syntax, m.id, m.inserted)
        items.push({ path: m.path, what: `block ${m.id}`, state })
      }
    }
    out.push({ id, entry, items })
  }
  return out
}
