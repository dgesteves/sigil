import Link from 'next/link'
import { getPosts } from '@/lib/posts'

export const metadata = { title: 'Posts' }

export default async function PostsPage() {
  const posts = await getPosts()
  return (
    <main>
      <h1>Posts</h1>
      <ul>
        {posts.map((p) => (
          <li key={p.slug} data-testid="post">
            <Link href={`/posts/${p.slug}`}>{p.title}</Link>
          </li>
        ))}
      </ul>
    </main>
  )
}
