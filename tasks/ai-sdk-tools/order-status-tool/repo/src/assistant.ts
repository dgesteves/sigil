import { generateText, type LanguageModel } from 'ai'
import type { OrderStore } from './orders.ts'

export const INSTRUCTIONS = `You are the customer support assistant for Northwind Outdoor.
Answer briefly and politely. If you do not know something, say so instead of guessing.`

export interface AnswerOptions {
  model: LanguageModel
  question: string
  orders: OrderStore
}

export async function answerCustomer({ model, question }: AnswerOptions): Promise<string> {
  const result = await generateText({
    model,
    instructions: INSTRUCTIONS,
    prompt: question,
  })
  return result.text
}
