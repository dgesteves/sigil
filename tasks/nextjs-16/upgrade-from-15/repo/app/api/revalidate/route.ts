import { revalidateTag } from 'next/cache'

// The CMS calls this after it publishes, with the shared secret in `x-cms-secret`.
export async function POST(request: Request) {
  const secret = process.env.CMS_WEBHOOK_SECRET
  if (!secret || request.headers.get('x-cms-secret') !== secret) {
    return new Response('Unauthorized', { status: 401 })
  }
  revalidateTag('posts')
  return Response.json({ revalidated: true })
}
