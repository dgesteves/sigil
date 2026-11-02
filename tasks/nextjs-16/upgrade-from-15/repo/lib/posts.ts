import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { unstable_cache } from 'next/cache'

export type Post = { slug: string; title: string; date: string; body: string }

const postsFile = join(process.cwd(), 'content', 'posts.json')

// The CMS export lands in content/posts.json; the CMS webhook tells us when it changed.
export const getPosts = unstable_cache(
  async (): Promise<Post[]> => JSON.parse(await readFile(postsFile, 'utf8')),
  ['posts'],
  { tags: ['posts'], revalidate: 3600 },
)

export async function getPost(slug: string): Promise<Post | undefined> {
  return (await getPosts()).find((p) => p.slug === slug)
}
