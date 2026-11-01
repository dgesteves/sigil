import { parse } from 'yaml'

export interface Frontmatter {
  data: Record<string, unknown>
  body: string
  /** 1-based line where the body starts, for findings that point into the body. */
  bodyLine: number
}

const FENCE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

/** Parses YAML frontmatter. Returns null when the file has none; throws on invalid YAML. */
export function parseFrontmatter(source: string): Frontmatter | null {
  const match = FENCE.exec(source)
  if (!match) return null
  const raw = parse(match[1] ?? '', { strict: true, uniqueKeys: true }) as unknown
  if (raw !== null && (typeof raw !== 'object' || Array.isArray(raw))) {
    throw new Error('frontmatter must be a YAML mapping')
  }
  const head = match[0]
  return {
    data: (raw ?? {}) as Record<string, unknown>,
    body: source.slice(head.length),
    bodyLine: head.split('\n').length,
  }
}
