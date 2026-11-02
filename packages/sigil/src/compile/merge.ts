import { isDeepStrictEqual } from 'node:util'
import type { JsonValue } from './types.js'

/* ------------------------------------------------------------------------------------------------
 * JSON merges. Sigil adds keys and array elements to shared settings files and records exactly
 * what it added, so removal takes out only its own entries. It never replaces a value it did not
 * write, and it refuses files that are not plain JSON rather than dropping their comments.
 * ---------------------------------------------------------------------------------------------- */

export class MergeError extends Error {}

type JsonObject = { [key: string]: JsonValue }

export interface JsonDoc {
  value: JsonObject
  indent: string
  newline: boolean
  existed: boolean
  /** The file is not in the formatting Sigil writes back, so saving it changes more than the edit. */
  reformatted: boolean
}

const isObject = (v: unknown): v is JsonObject => !!v && typeof v === 'object' && !Array.isArray(v)

/**
 * Keys that reach Object.prototype through ordinary property access. Pointers come from capability
 * payloads (an MCP server's name, a hook's event) and from the lockfile, so they are untrusted: a
 * `__proto__` segment would let a capability change every object in the CLI process.
 */
function isUnsafeKey(key: string): boolean {
  return key === '__proto__' || key === 'constructor' || key === 'prototype'
}

function safeKey(key: string, pointer: string[], path: string): string {
  if (isUnsafeKey(key))
    throw new MergeError(`${path}: refusing the key "${key}" in ${pointer.join('.')}`)
  return key
}

export function parseJsonDoc(buf: Buffer | undefined, path: string): JsonDoc {
  if (buf === undefined || buf.toString('utf8').trim() === '')
    return {
      value: {},
      indent: '  ',
      newline: true,
      existed: buf !== undefined,
      reformatted: false,
    }
  const text = buf.toString('utf8')
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new MergeError(
      `${path} is not plain JSON (comments or trailing commas?), so Sigil will not rewrite it`,
    )
  }
  if (!isObject(value)) throw new MergeError(`${path} must contain a JSON object`)
  const indent = /^([ \t]+)"/m.exec(text)?.[1] ?? '  '
  const newline = text.endsWith('\n')
  const doc = { value, indent, newline, existed: true, reformatted: false }
  doc.reformatted = serializeJson(doc).toString('utf8') !== text
  return doc
}

export function serializeJson(doc: Pick<JsonDoc, 'value' | 'indent' | 'newline'>): Buffer {
  return Buffer.from(
    `${JSON.stringify(doc.value, null, doc.indent)}${doc.newline ? '\n' : ''}`,
    'utf8',
  )
}

/** Walks to the parent of the last key, creating objects as needed; returns the created prefixes. */
function parentOf(
  doc: JsonDoc,
  pointer: string[],
  path: string,
): { parent: JsonObject; created: string[][] } {
  const created: string[][] = []
  let node: JsonObject = doc.value
  for (let i = 0; i < pointer.length - 1; i++) {
    const key = safeKey(pointer[i]!, pointer, path)
    const next = Object.hasOwn(node, key) ? node[key] : undefined
    if (next === undefined) {
      node[key] = {}
      created.push(pointer.slice(0, i + 1))
    } else if (!isObject(next)) {
      throw new MergeError(`${path}: ${pointer.slice(0, i + 1).join('.')} is not an object`)
    }
    node = node[key] as JsonObject
  }
  return { parent: node, created }
}

export interface Applied {
  createdContainers: string[][]
  /** The value was already there, identical; it is left in place on removal. */
  adopted: boolean
}

export function applySet(doc: JsonDoc, pointer: string[], value: JsonValue, path: string): Applied {
  const key = safeKey(pointer.at(-1)!, pointer, path)
  const { parent, created } = parentOf(doc, pointer, path)
  if (Object.hasOwn(parent, key)) {
    if (isDeepStrictEqual(parent[key], value)) return { createdContainers: created, adopted: true }
    throw new MergeError(
      `${path} already defines ${pointer.join('.')}; Sigil will not replace settings it did not write`,
    )
  }
  parent[key] = value
  return { createdContainers: created, adopted: false }
}

export function applyAppend(
  doc: JsonDoc,
  pointer: string[],
  value: JsonValue,
  path: string,
): Applied {
  const key = safeKey(pointer.at(-1)!, pointer, path)
  const { parent, created } = parentOf(doc, pointer, path)
  if (!Object.hasOwn(parent, key)) {
    parent[key] = []
    created.push(pointer)
  }
  const list = parent[key]
  if (!Array.isArray(list)) throw new MergeError(`${path}: ${pointer.join('.')} is not an array`)
  if (list.some((v) => isDeepStrictEqual(v, value)))
    return { createdContainers: created, adopted: true }
  list.push(value)
  return { createdContainers: created, adopted: false }
}

function get(doc: JsonDoc, pointer: string[]): JsonValue | undefined {
  let node: JsonValue | undefined = doc.value
  for (const key of pointer) {
    if (!isObject(node) || isUnsafeKey(key) || !Object.hasOwn(node, key)) return undefined
    node = node[key]
  }
  return node
}

export type RevertStatus = 'removed' | 'modified' | 'missing'

/** Current state of a recorded merge, for `sigil list` and for drift checks before removal. */
export function mergeStatus(
  doc: JsonDoc,
  op: 'set' | 'append',
  pointer: string[],
  value: JsonValue,
): 'ok' | 'modified' | 'missing' {
  const at = get(doc, pointer)
  if (op === 'set')
    return at === undefined ? 'missing' : isDeepStrictEqual(at, value) ? 'ok' : 'modified'
  return Array.isArray(at) && at.some((v) => isDeepStrictEqual(v, value)) ? 'ok' : 'missing'
}

/** Undoes one merge. A modified `set` value is removed only with `force`. */
export function revert(
  doc: JsonDoc,
  op: 'set' | 'append',
  pointer: string[],
  value: JsonValue,
  force: boolean,
): RevertStatus {
  const parentPath = pointer.slice(0, -1)
  const parent = parentPath.length ? get(doc, parentPath) : doc.value
  const key = pointer.at(-1)!
  if (!isObject(parent) || isUnsafeKey(key) || !Object.hasOwn(parent, key)) return 'missing'
  if (op === 'set') {
    if (!isDeepStrictEqual(parent[key], value) && !force) return 'modified'
    delete parent[key]
    return 'removed'
  }
  const list = parent[key]
  if (!Array.isArray(list)) return 'missing'
  const i = list.findIndex((v) => isDeepStrictEqual(v, value))
  if (i === -1) return 'missing'
  list.splice(i, 1)
  return 'removed'
}

/** Removes containers Sigil created, deepest first, if they are now empty. Returns the ones kept. */
export function pruneContainers(doc: JsonDoc, created: string[][]): string[][] {
  const kept: string[][] = []
  for (const pointer of [...created].sort((a, b) => b.length - a.length)) {
    const parent = pointer.length > 1 ? get(doc, pointer.slice(0, -1)) : doc.value
    const key = pointer.at(-1)!
    if (!isObject(parent) || isUnsafeKey(key) || !Object.hasOwn(parent, key)) continue
    const v = parent[key]
    const empty = Array.isArray(v) ? v.length === 0 : isObject(v) && Object.keys(v).length === 0
    if (empty) delete parent[key]
    else kept.push(pointer)
  }
  return kept
}

/* ------------------------------------------------------------------------------------------------
 * Marked text blocks for shared markdown and TOML files.
 * ---------------------------------------------------------------------------------------------- */

export type BlockSyntax = 'markdown' | 'toml'

export function markers(syntax: BlockSyntax, id: string): { begin: string; end: string } {
  return syntax === 'markdown'
    ? { begin: `<!-- sigil:begin ${id} -->`, end: `<!-- sigil:end ${id} -->` }
    : { begin: `# sigil:begin ${id}`, end: `# sigil:end ${id}` }
}

export function hasBlock(text: string, syntax: BlockSyntax, id: string): boolean {
  return text.includes(markers(syntax, id).begin)
}

/** Appends a block and returns exactly what was inserted, so removal restores the original bytes. */
export function appendBlock(
  text: string | undefined,
  syntax: BlockSyntax,
  id: string,
  content: string,
): { text: string; inserted: string } {
  const { begin, end } = markers(syntax, id)
  let stop = content.length
  // A loop, not /\n+$/: that pattern is quadratic on content with long runs of newlines.
  while (stop > 0 && content[stop - 1] === '\n') stop--
  const block = `${begin}\n${content.slice(0, stop)}\n${end}\n`
  const base = text ?? ''
  const sep = base === '' || base.endsWith('\n\n') ? '' : base.endsWith('\n') ? '\n' : '\n\n'
  return { text: base + sep + block, inserted: sep + block }
}

export function removeBlock(
  text: string,
  syntax: BlockSyntax,
  id: string,
  inserted: string,
  force: boolean,
): { text: string; status: RevertStatus } {
  const at = text.lastIndexOf(inserted)
  if (at !== -1)
    return { text: text.slice(0, at) + text.slice(at + inserted.length), status: 'removed' }
  const { begin, end } = markers(syntax, id)
  const start = text.indexOf(begin)
  if (start === -1) return { text, status: 'missing' }
  if (!force) return { text, status: 'modified' }
  const stop = text.indexOf(end, start)
  const cut =
    stop === -1 ? text.length : stop + end.length + (text[stop + end.length] === '\n' ? 1 : 0)
  return { text: text.slice(0, start) + text.slice(cut), status: 'removed' }
}

export function blockStatus(
  text: string | undefined,
  syntax: BlockSyntax,
  id: string,
  inserted: string,
): 'ok' | 'modified' | 'missing' {
  if (text === undefined) return 'missing'
  if (text.includes(inserted)) return 'ok'
  return hasBlock(text, syntax, id) ? 'modified' : 'missing'
}

/** TOML tables a block declares that the file already has: appending them would make invalid TOML. */
export function tomlConflicts(existing: string, block: string): string[] {
  const norm = (h: string) => h.replace(/\s+/g, '').replace(/"([A-Za-z0-9_-]+)"/g, '$1')
  const have = new Set([...existing.matchAll(/^\s*\[([^\]\n]+)\]\s*$/gm)].map((m) => norm(m[1]!)))
  return [...block.matchAll(/^\[([^\]\n]+)\]$/gm)]
    .map((m) => m[1]!)
    .filter((h) => have.has(norm(h)))
}
