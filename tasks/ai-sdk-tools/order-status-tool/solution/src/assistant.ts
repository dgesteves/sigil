import { generateText, isStepCount, type LanguageModel, tool } from 'ai'
import { z } from 'zod'
import type { OrderStore } from './orders.ts'

export const INSTRUCTIONS = `You are the customer support assistant for Northwind Outdoor.
Answer briefly and politely. If you do not know something, say so instead of guessing.
Use the getOrderStatus tool whenever the customer asks about an order.`

export interface AnswerOptions {
  model: LanguageModel
  question: string
  orders: OrderStore
}

export function orderTools(orders: OrderStore) {
  return {
    getOrderStatus: tool({
      description: 'Look up the current status, carrier and estimated delivery date of an order.',
      inputSchema: z.object({
        orderId: z
          .string()
          .regex(/^ORD-\d+$/, 'order ids look like ORD-1234')
          .describe('The order id, e.g. ORD-1234'),
      }),
      execute: async ({ orderId }) => {
        const order = await orders.findById(orderId)
        if (!order) return { found: false as const, orderId, message: `No order ${orderId} was found.` }
        return {
          found: true as const,
          orderId,
          status: order.status,
          carrier: order.carrier ?? null,
          eta: order.eta ?? null,
        }
      },
    }),
  }
}

export async function answerCustomer({ model, question, orders }: AnswerOptions): Promise<string> {
  const result = await generateText({
    model,
    instructions: INSTRUCTIONS,
    prompt: question,
    tools: orderTools(orders),
    // generateText stops after one step unless told otherwise; 4 steps = at most 4 model calls.
    stopWhen: isStepCount(4),
  })
  return result.text
}
