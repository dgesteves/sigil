import { getData } from '@/lib/server/data'

export const dynamic = 'force-static'

export async function GET() {
  const { registry, demo } = await getData()
  return Response.json(demo ? { demo: true, ...registry } : registry, {
    headers: { 'access-control-allow-origin': '*' },
  })
}
