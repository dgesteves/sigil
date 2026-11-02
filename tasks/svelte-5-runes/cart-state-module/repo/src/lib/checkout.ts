import { get } from 'svelte/store'
import { lines, subtotalCents } from './cart.ts'
import type { CartLine } from './types.ts'

export interface OrderPayload {
  currency: 'EUR'
  lines: CartLine[]
  subtotalCents: number
  createdAt: string
}

/** The payload we post to the payment iframe. */
export function buildOrder(now = new Date()): OrderPayload {
  return {
    currency: 'EUR',
    lines: get(lines),
    subtotalCents: get(subtotalCents),
    createdAt: now.toISOString(),
  }
}

/** Hands the order to the payment provider's iframe (postMessage structured-clones the payload). */
export function sendToPaymentFrame(frame: Window, origin: string) {
  frame.postMessage({ type: 'order', order: buildOrder() }, origin)
}
