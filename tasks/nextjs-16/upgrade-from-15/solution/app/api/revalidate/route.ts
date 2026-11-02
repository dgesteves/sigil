import { revalidateTag } from 'next/cache'

// The CMS calls this after it publishes, with the shared secret in `x-cms-secret`.
export async function POST(request: Request) {
  const secret = process.env.CMS_WEBHOOK_SECRET
  if (!secret || request.headers.get('x-cms-secret') !== secret) {
    return new Response('Unauthorized', { status: 401 })
  }
  // The one-argument form expired the tag immediately. `{ expire: 0 }` keeps that: the next view
  // waits for fresh posts instead of getting one stale response ('max' would be stale-while-revalidate).
  revalidateTag('posts', { expire: 0 })
  return Response.json({ revalidated: true })
}
