import { getTaxonomy } from '@/lib/server/data'

export const dynamic = 'force-static'

/** The technology vocabulary and detection signatures, for the Oracle's stack detection. */
export async function GET() {
  const t = await getTaxonomy()
  return Response.json(t?.technologies ?? [], {
    headers: { 'cache-control': 'public, max-age=3600, stale-while-revalidate=86400' },
  })
}
