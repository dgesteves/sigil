import { llmsTxt } from '@/lib/machine'
import { getData } from '@/lib/server/data'
import { SITE_URL } from '@/lib/site'

export const dynamic = 'force-static'

export async function GET() {
  const d = await getData()
  const meta = {
    demo: d.demo,
    source: d.source,
    generatedAt: d.registry.generatedAt,
    ...(d.commit ? { commit: d.commit } : {}),
  }
  return new Response(llmsTxt(d.views, meta, SITE_URL), {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  })
}
