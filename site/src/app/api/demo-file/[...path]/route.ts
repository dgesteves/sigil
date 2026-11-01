import { readDemoFile } from '@/lib/server/data'

/** Serves DEMO payload files to the seal verifier in development. Always 404 on real data. */
export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params
  const buf = await readDemoFile(path.join('/'))
  if (!buf) return new Response('not found', { status: 404 })
  return new Response(new Uint8Array(buf), {
    headers: { 'content-type': 'application/octet-stream', 'cache-control': 'no-store' },
  })
}
