import { get } from 'svelte/store'
import { beforeEach, describe, expect, test } from 'vitest'
import { addItem, clearCart, count, hasItem, lines, removeItem, setQty, subtotalCents } from '../src/lib/cart.ts'

const mug = { sku: 'MUG-01', name: 'Mug', unitPriceCents: 1250 }
const tee = { sku: 'TEE-02', name: 'T-shirt', unitPriceCents: 2000 }

beforeEach(() => clearCart())

describe('cart', () => {
  test('adding merges lines by sku', () => {
    addItem(mug)
    addItem(mug, 2)
    addItem(tee)
    expect(get(lines).map((l) => [l.sku, l.qty])).toEqual([
      ['MUG-01', 3],
      ['TEE-02', 1],
    ])
    expect(get(count)).toBe(4)
    expect(get(subtotalCents)).toBe(3 * 1250 + 2000)
    expect(hasItem('TEE-02')).toBe(true)
  })

  test('setQty clamps and removes at zero', () => {
    addItem(mug)
    setQty('MUG-01', 250)
    expect(get(lines)[0]!.qty).toBe(99)
    setQty('MUG-01', 0)
    expect(get(lines)).toEqual([])
  })

  test('removeItem and persistence', () => {
    addItem(mug)
    addItem(tee)
    removeItem('MUG-01')
    expect(JSON.parse(localStorage.getItem('cart:v1')!)).toEqual([{ ...tee, qty: 1 }])
  })
})
