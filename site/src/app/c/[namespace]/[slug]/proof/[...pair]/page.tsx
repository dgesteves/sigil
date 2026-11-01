import { notFound } from 'next/navigation'
import { parsePair, renderTheater } from '@/components/theater/render'
import { getData, getTraces, pairTraces } from '@/lib/server/data'

type Params = { namespace: string; slug: string; pair: string[] }
export const dynamicParams = false

export async function generateStaticParams(): Promise<Params[]> {
  const { entries } = await getData()
  const out: Params[] = []
  for (const e of entries) {
    const [namespace, slug] = e.manifest.id.split('/') as [string, string]
    for (const p of pairTraces(await getTraces(e))) {
      out.push({ namespace, slug, pair: [...p.suite.split('/'), p.task, String(p.run)] })
    }
  }
  return out
}

export const metadata = { title: 'Proof theater' }

export default async function ProofPair({ params }: { params: Promise<Params> }) {
  const { namespace, slug, pair } = await params
  const wanted = parsePair(pair)
  if (!wanted) notFound()
  return renderTheater(namespace, slug, wanted)
}
