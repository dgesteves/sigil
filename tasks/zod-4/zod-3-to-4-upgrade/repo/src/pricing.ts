import { z } from 'zod'
import { Money, Order } from './schemas.ts'

/** Order total in minor units. Validates its input and output, so callers can pass raw JSON. */
export const orderTotal = z
  .function()
  .args(Order)
  .returns(Money)
  .implement((order) => {
    const currency = order.items[0].unitPrice.currency
    let amount = 0
    for (const item of order.items) {
      if (item.unitPrice.currency !== currency) throw new Error('Mixed currencies in one order')
      amount += item.unitPrice.amount * item.quantity
    }
    return { amount, currency }
  })
