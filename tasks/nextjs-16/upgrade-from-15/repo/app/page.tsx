import Image from 'next/image'
import Link from 'next/link'
import { getPosts } from '@/lib/posts'

export default async function Home() {
  const [latest] = await getPosts()
  return (
    <main>
      <Image
        src="https://images.fieldnotes.dev/hero/ridge-at-dawn.jpg"
        alt="A ridge line at dawn"
        width={1600}
        height={900}
        quality={90}
        priority
      />
      <h1>Field Notes</h1>
      {latest && (
        <p data-testid="latest">
          Latest: <Link href={`/posts/${latest.slug}`}>{latest.title}</Link>
        </p>
      )}
    </main>
  )
}
