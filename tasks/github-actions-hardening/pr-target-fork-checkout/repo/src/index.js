import { parse } from 'yaml'

const FENCE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

/** Returns { data, body } for a markdown document with optional YAML front matter. */
export function frontMatter(source) {
  const match = FENCE.exec(source)
  if (!match) return { data: {}, body: source }
  const data = parse(match[1]) ?? {}
  if (typeof data !== 'object' || Array.isArray(data)) throw new TypeError('front matter must be a mapping')
  return { data, body: source.slice(match[0].length) }
}
