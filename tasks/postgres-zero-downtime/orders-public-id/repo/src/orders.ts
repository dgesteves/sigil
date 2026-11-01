import type { Queryable } from './migrate.ts'

export interface NewOrder {
  customerId: number
  totalCents: number
  currency?: string
}

export const ORDER_HISTORY_SQL = `
  SELECT id, status, total_cents, currency, created_at
  FROM orders
  WHERE customer_id = $1
  ORDER BY created_at DESC
  LIMIT $2`

/** Backs GET /customers/:id/orders (newest first, paginated by the client). */
export async function orderHistory(db: Queryable, customerId: number, limit = 20) {
  return (await db.query(ORDER_HISTORY_SQL, [customerId, limit])).rows
}

export async function createOrder(db: Queryable, order: NewOrder) {
  const { rows } = await db.query(
    `INSERT INTO orders (customer_id, total_cents, currency)
     VALUES ($1, $2, $3)
     RETURNING id, status, total_cents, currency, created_at`,
    [order.customerId, order.totalCents, order.currency ?? 'EUR'],
  )
  return rows[0]
}

export async function setStatus(db: Queryable, orderId: number, status: string) {
  await db.query('UPDATE orders SET status = $2, updated_at = now() WHERE id = $1', [
    orderId,
    status,
  ])
}
