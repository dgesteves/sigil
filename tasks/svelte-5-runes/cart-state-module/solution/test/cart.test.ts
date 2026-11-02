import { beforeEach, describe, expect, test } from 'vitest'
import { Cart } from '../src/lib/cart.svelte.ts'

const mug = { sku: 'MUG-01', name: 'Mug', unitPriceCents: 1250 }
const tee = { sku: 'TEE-02', name: 'T-shirt', unitPriceCents: 2000 }

let cart: Cart
beforeEach(() => {
  localStorage.clear()
  cart = new Cart(localStorage)
})

describe('cart', () => {
  test('adding merges lines by sku', () => {
    cart.add(mug)
    cart.add(mug, 2)
    cart.add(tee)
    expect(cart.lines.map((l) => [l.sku, l.qty])).toEqual([
      ['MUG-01', 3],
      ['TEE-02', 1],
    ])
    expect(cart.count).toBe(4)
    expect(cart.subtotalCents).toBe(3 * 1250 + 2000)
    expect(cart.has('TEE-02')).toBe(true)
  })

  test('setQty clamps and removes at zero', () => {
    cart.add(mug)
    cart.setQty('MUG-01', 250)
    expect(cart.lines[0]!.qty).toBe(99)
    cart.setQty('MUG-01', 0)
    expect(cart.lines).toEqual([])
  })

  test('remove and persistence', () => {
    cart.add(mug)
    cart.add(tee)
    cart.remove('MUG-01')
    expect(JSON.parse(localStorage.getItem('cart:v1')!)).toEqual([{ ...tee, qty: 1 }])
  })
})
