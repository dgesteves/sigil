import { renderTheater } from '@/components/theater/render'
import { getData } from '@/lib/server/data'

type Params = { namespace: string; slug: string }
export const dynamicParams = false

export async function generateStaticParams(): Promise<Params[]> {
  const { views } = await getData()
  return views.map((v) => ({ namespace: v.ns, slug: v.slug }))
}

export const metadata = { title: 'Proof theater' }

export default async function Proof({ params }: { params: Promise<Params> }) {
  const { namespace, slug } = await params
  return renderTheater(namespace, slug)
}
