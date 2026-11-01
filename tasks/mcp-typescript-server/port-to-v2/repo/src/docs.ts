import { readdirSync, readFileSync } from 'node:fs'

export interface Doc {
  slug: string
  title: string
  body: string
}

export interface Hit {
  slug: string
  title: string
  excerpt: string
  score: number
}

const docsDir = new URL('../docs/', import.meta.url)

export function loadDocs(): Doc[] {
  return readdirSync(docsDir)
    .filter((file) => file.endsWith('.md'))
    .sort()
    .map((file) => {
      const body = readFileSync(new URL(file, docsDir), 'utf8')
      const title = /^#\s+(.+)$/m.exec(body)?.[1]?.trim() ?? file
      return { slug: file.replace(/\.md$/, ''), title, body }
    })
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

/** Case-insensitive substring search, best match first. */
export function searchDocs(docs: Doc[], query: string, limit: number): Hit[] {
  const needle = query.toLowerCase()
  return docs
    .map((doc) => {
      const score = doc.body.toLowerCase().split(needle).length - 1
      const line = doc.body.split('\n').find((l) => l.toLowerCase().includes(needle)) ?? doc.title
      const excerpt = line.replace(/^[#\-\d.\s]+/, '').trim().slice(0, 80)
      return { slug: doc.slug, title: doc.title, excerpt, score }
    })
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score || a.slug.localeCompare(b.slug))
    .slice(0, limit)
}
