// Called by the warehouse system after it has written new stock levels to the catalog database.
// Contract: POST, header `x-inventory-secret`, JSON body `{ "productIds": ["p-100", ...] }`.
export async function POST(request: Request) {
  const secret = process.env.INVENTORY_WEBHOOK_SECRET
  if (!secret || request.headers.get('x-inventory-secret') !== secret) {
    return new Response('Unauthorized', { status: 401 })
  }

  const body: unknown = await request.json().catch(() => null)
  const productIds =
    body && typeof body === 'object' && 'productIds' in body && Array.isArray(body.productIds)
      ? body.productIds.filter((id): id is string => typeof id === 'string')
      : null
  if (!productIds) {
    return Response.json({ error: 'productIds must be an array of strings' }, { status: 400 })
  }

  // Product pages read straight from the database, so there is nothing to refresh yet.
  return Response.json({ ok: true, productIds })
}
