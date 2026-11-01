import { z } from 'zod'
import { OrderId, OrderStatus } from './schemas.ts'

/** GET /orders query string, after the router has turned it into an object of strings. */
export const ListOrdersQuery = z.object({
  status: z
    .string()
    .transform((value) => value.split(','))
    .pipe(z.array(OrderStatus))
    .default('pending,paid'),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  includeArchived: z.coerce.boolean(),
  cursor: OrderId.optional(),
})
export type ListOrdersQuery = z.infer<typeof ListOrdersQuery>
