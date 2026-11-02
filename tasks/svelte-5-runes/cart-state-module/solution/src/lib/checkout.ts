import { type Cart, cart } from './cart.svelte.ts'
import type { CartLine } from './types.ts'

export interface OrderPayload {
  currency: 'EUR'
  lines: CartLine[]
  subtotalCents: number
  createdAt: string
}

/** The payload we post to the payment iframe. */
export function buildOrder(source: Cart = cart, now = new Date()): OrderPayload {
  return {
    currency: 'EUR',
    // cart.lines is a $state proxy, which postMessage (structuredClone) rejects; copy it out.
    // ($state.snapshot is a rune, so it is only available in .svelte/.svelte.ts files.)
    lines: source.lines.map((line) => ({ ...line })),
    subtotalCents: source.subtotalCents,
    createdAt: now.toISOString(),
  }
}

/** Hands the order to the payment provider's iframe (postMessage structured-clones the payload). */
export function sendToPaymentFrame(frame: Window, origin: string, source: Cart = cart) {
  frame.postMessage({ type: 'order', order: buildOrder(source) }, origin)
}
