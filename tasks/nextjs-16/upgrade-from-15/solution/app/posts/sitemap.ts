import type { MetadataRoute } from 'next'
import { getPosts } from '@/lib/posts'

const URLS_PER_SITEMAP = 50_000

export async function generateSitemaps() {
  const count = Math.max(1, Math.ceil((await getPosts()).length / URLS_PER_SITEMAP))
  return Array.from({ length: count }, (_, id) => ({ id }))
}

// Next 16 passes the id as a Promise of the URL segment (a string).
export default async function sitemap({ id }: { id: Promise<string> }): Promise<MetadataRoute.Sitemap> {
  const start = Number(await id) * URLS_PER_SITEMAP
  const posts = (await getPosts()).slice(start, start + URLS_PER_SITEMAP)
  return posts.map((p) => ({ url: `https://fieldnotes.dev/posts/${p.slug}`, lastModified: p.date }))
}
