import * as z from 'zod'
import { Money, Order } from './schemas.ts'

/** Order total in minor units. Validates its input and output, so callers can pass raw JSON. */
export const orderTotal = z.function({ input: [Order], output: Money }).implement((order) => {
  const [first] = order.items
  if (!first) throw new Error('An order needs at least one item')
  const currency = first.unitPrice.currency
  let amount = 0
  for (const item of order.items) {
    if (item.unitPrice.currency !== currency) throw new Error('Mixed currencies in one order')
    amount += item.unitPrice.amount * item.quantity
  }
  return { amount, currency }
})
