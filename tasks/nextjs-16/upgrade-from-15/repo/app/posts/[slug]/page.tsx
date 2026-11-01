import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getPost, getPosts } from '@/lib/posts'

type Props = { params: Promise<{ slug: string }> }

export async function generateStaticParams() {
  return (await getPosts()).map((p) => ({ slug: p.slug }))
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const post = await getPost((await params).slug)
  return { title: post?.title ?? 'Not found' }
}

export default async function PostPage({ params }: Props) {
  const post = await getPost((await params).slug)
  if (!post) notFound()
  return (
    <article>
      <h1 data-testid="title">{post.title}</h1>
      <time dateTime={post.date}>{post.date}</time>
      <p>{post.body}</p>
    </article>
  )
}
