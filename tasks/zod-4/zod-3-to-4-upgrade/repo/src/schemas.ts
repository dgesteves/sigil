import { z } from 'zod'

export const OrderStatus = z.enum(['pending', 'paid', 'shipped', 'cancelled'])
export type OrderStatus = z.infer<typeof OrderStatus>

// Order ids are minted by the legacy order system. They are UUID-shaped (8-4-4-4-12 hex) but do not
// follow the RFC version/variant layout, so they must not be validated as RFC UUIDs.
export const OrderId = z.string().uuid({ message: 'Invalid order id' })

export const Currency = z.enum(['EUR', 'USD', 'GBP'])

export const Money = z.object({
  amount: z.number().int().nonnegative(),
  currency: Currency,
})
export type Money = z.infer<typeof Money>

export const Sku = z
  .string({ required_error: 'SKU is required', invalid_type_error: 'SKU must be a string' })
  .min(1)
  .max(32)

export const Quantity = z
  .number({
    errorMap: (issue, ctx) =>
      issue.code === z.ZodIssueCode.invalid_type
        ? { message: 'Quantity must be a number' }
        : { message: ctx.defaultError },
  })
  .int()
  .positive()

export const LineItem = z.object({
  sku: Sku,
  quantity: Quantity,
  unitPrice: Money,
})
export type LineItem = z.infer<typeof LineItem>

export const ShippingOptions = z.object({
  method: z.enum(['standard', 'express']).default('standard'),
  insured: z.boolean().default(false),
})

export const Region = z.enum(['eu', 'us', 'uk'])

export const DiscountCode = z
  .string()
  .refine(
    (code) => /^[A-Z0-9]{6,12}$/.test(code),
    (code) => ({ message: `Unknown discount code format: ${code}` }),
  )

export const Order = z
  .object({
    id: OrderId,
    customerEmail: z.string().email({ message: 'Invalid email' }),
    status: OrderStatus.default('pending'),
    items: z.array(LineItem).nonempty({ message: 'An order needs at least one item' }),
    shipping: ShippingOptions.default({}),
    // Price overrides for some regions; most orders override one region or none.
    regionalPrices: z.record(Region, Money).optional(),
    discountCode: DiscountCode.optional(),
    // Free-form storefront metadata; many clients never send it.
    metadata: z.unknown(),
    placedFromIp: z.string().ip().optional(),
  })
  .strict()
export type Order = z.infer<typeof Order>
