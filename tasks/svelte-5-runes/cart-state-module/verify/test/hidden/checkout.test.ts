import { describe, expect, test, vi } from 'vitest'
import { Cart } from '../../src/lib/cart.svelte.ts'
import { buildOrder, sendToPaymentFrame } from '../../src/lib/checkout.ts'
import { MemoryStorage } from './memory-storage.ts'

const mug = { sku: 'MUG-01', name: 'Mug', unitPriceCents: 1250 }
const tee = { sku: 'TEE-02', name: 'T-shirt', unitPriceCents: 2000 }

describe('buildOrder', () => {
  test('reads the given cart and survives structuredClone (postMessage)', () => {
    const cart = new Cart(new MemoryStorage())
    cart.add(mug, 2)
    cart.add(tee)
    const order = buildOrder(cart)
    const cloned = structuredClone(order)
    expect(cloned.currency).toBe('EUR')
    expect(cloned.subtotalCents).toBe(4500)
    expect(cloned.lines).toEqual([
      { ...mug, qty: 2 },
      { ...tee, qty: 1 },
    ])
    expect(typeof cloned.createdAt).toBe('string')
  })

  test('is a snapshot: later cart changes do not leak into it', () => {
    const cart = new Cart(new MemoryStorage())
    cart.add(mug)
    const order = buildOrder(cart)
    cart.add(mug, 5)
    cart.add(tee)
    expect(order.lines).toEqual([{ ...mug, qty: 1 }])
    expect(order.subtotalCents).toBe(1250)
  })

  test('sendToPaymentFrame posts a cloneable message', () => {
    const postMessage = vi.fn((message: unknown, _origin: string) => structuredClone(message))
    const frame = { postMessage } as unknown as Window
    sendToPaymentFrame(frame, 'https://pay.example')
    expect(postMessage).toHaveBeenCalledTimes(1)
    expect(postMessage.mock.calls[0]![1]).toBe('https://pay.example')
  })
})
