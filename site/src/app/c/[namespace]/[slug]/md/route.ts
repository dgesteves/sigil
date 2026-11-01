import { capabilityMarkdown } from '@/lib/machine'
import { toView } from '@/lib/model'
import { getData, getEntry } from '@/lib/server/data'

export const dynamicParams = false

export async function generateStaticParams() {
  const { views } = await getData()
  return views.map((v) => ({ namespace: v.ns, slug: v.slug }))
}

/** The capability as an agent reads it. Also served at /c/<namespace>/<slug>.md. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ namespace: string; slug: string }> },
) {
  const { namespace, slug } = await params
  const entry = await getEntry(namespace, slug)
  if (!entry) return new Response('not found', { status: 404 })
  const d = await getData()
  const meta = {
    demo: d.demo,
    source: d.source,
    generatedAt: d.registry.generatedAt,
    ...(d.commit ? { commit: d.commit } : {}),
  }
  return new Response(capabilityMarkdown(entry, toView(entry), meta), {
    headers: { 'content-type': 'text/markdown; charset=utf-8' },
  })
}
