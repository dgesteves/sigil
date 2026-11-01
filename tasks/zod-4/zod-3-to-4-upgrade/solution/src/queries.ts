import * as z from 'zod'
import { OrderId, OrderStatus } from './schemas.ts'

/** GET /orders query string, after the router has turned it into an object of strings. */
export const ListOrdersQuery = z.object({
  // .prefault() feeds the default through the transform, as Zod 3's .default() did.
  status: z
    .string()
    .transform((value) => value.split(','))
    .pipe(z.array(OrderStatus))
    .prefault('pending,paid'),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  // A missing z.coerce.* key is an error in Zod 4; Zod 3 coerced undefined to false.
  includeArchived: z.coerce.boolean().default(false),
  cursor: OrderId.optional(),
})
export type ListOrdersQuery = z.infer<typeof ListOrdersQuery>
