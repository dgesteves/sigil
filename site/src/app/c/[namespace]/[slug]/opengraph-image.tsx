import { pp, TYPE_LABEL, toView } from '@/lib/model'
import { getData, getEntry } from '@/lib/server/data'
import { OG_SIZE, ogImage } from '@/lib/server/og'

export const size = OG_SIZE
export const contentType = 'image/png'
export const alt = 'Sigil capability seal'

const TONE: Record<string, string> = {
  proven: '#ffaa45',
  inconclusive: '#d9c7a3',
  'no-effect': '#a9aca4',
  untested: '#8a847a',
  harmful: '#ff4d3d',
}

export async function generateStaticParams() {
  const { views } = await getData()
  return views.map((v) => ({ namespace: v.ns, slug: v.slug }))
}

export default async function Image({
  params,
}: {
  params: Promise<{ namespace: string; slug: string }>
}) {
  const { namespace, slug } = await params
  const entry = await getEntry(namespace, slug)
  const { demo } = await getData()
  if (!entry) return new Response('not found', { status: 404 })
  const v = toView(entry)
  return ogImage({
    digest: entry.digest,
    kicker: `${TYPE_LABEL[v.type]} · ${v.id} · ${v.level}`,
    title: v.name,
    line: v.summary,
    verdict: {
      label: v.uplift.replace('-', ' '),
      color: TONE[v.uplift] ?? '#ffaa45',
      ...(v.lead
        ? {
            value: `${pp(v.lead.delta)}`,
            interval: `pts [${pp(v.lead.ci95[0])}, ${pp(v.lead.ci95[1])}]`,
          }
        : {}),
    },
    demo,
  })
}
