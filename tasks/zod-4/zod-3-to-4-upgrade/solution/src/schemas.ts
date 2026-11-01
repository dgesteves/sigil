import * as z from 'zod'

export const OrderStatus = z.enum(['pending', 'paid', 'shipped', 'cancelled'])
export type OrderStatus = z.infer<typeof OrderStatus>

// Order ids are minted by the legacy order system. They are UUID-shaped (8-4-4-4-12 hex) but do not
// follow the RFC version/variant layout. z.uuid() enforces RFC 9562 in Zod 4; z.guid() is the
// shape-only check Zod 3's .uuid() used to be.
export const OrderId = z.guid({ error: 'Invalid order id' })

export const Currency = z.enum(['EUR', 'USD', 'GBP'])

export const Money = z.object({
  amount: z.int().nonnegative(),
  currency: Currency,
})
export type Money = z.infer<typeof Money>

// A schema-level error also applies to the schema's own checks (.min/.max) in Zod 4, so only answer
// for the type problems and return undefined to keep the default length messages.
export const Sku = z
  .string({
    error: (issue) => {
      if (issue.code !== 'invalid_type') return undefined
      return issue.input === undefined ? 'SKU is required' : 'SKU must be a string'
    },
  })
  .min(1)
  .max(32)

export const Quantity = z
  .number({ error: (issue) => (issue.code === 'invalid_type' ? 'Quantity must be a number' : undefined) })
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
  .refine((code) => /^[A-Z0-9]{6,12}$/.test(code), {
    error: (issue) => `Unknown discount code format: ${String(issue.input)}`,
  })

export const Order = z.strictObject({
  id: OrderId,
  customerEmail: z.email({ error: 'Invalid email' }),
  status: OrderStatus.default('pending'),
  items: z.array(LineItem).min(1, { error: 'An order needs at least one item' }),
  // .default() short-circuits in Zod 4 and would return {} without the inner defaults;
  // .prefault() parses {} like Zod 3's .default() did.
  shipping: ShippingOptions.prefault({}),
  // Price overrides for some regions; most orders override one region or none. z.record() with
  // enum keys is exhaustive in Zod 4.
  regionalPrices: z.partialRecord(Region, Money).optional(),
  discountCode: DiscountCode.optional(),
  // Free-form storefront metadata; many clients never send it. z.unknown() keys are required in Zod 4.
  metadata: z.unknown().optional(),
  placedFromIp: z.union([z.ipv4(), z.ipv6()]).optional(),
})
export type Order = z.infer<typeof Order>
