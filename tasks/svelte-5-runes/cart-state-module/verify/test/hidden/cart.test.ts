import { tick } from 'svelte'
import { describe, expect, test } from 'vitest'
// Importing the module also creates the shared cart: that must work outside any component.
import { Cart } from '../../src/lib/cart.svelte.ts'
import { MemoryStorage, plain } from './memory-storage.ts'

const mug = { sku: 'MUG-01', name: 'Mug', unitPriceCents: 1250 }
const tee = { sku: 'TEE-02', name: 'T-shirt', unitPriceCents: 2000 }
const cap = { sku: 'CAP-03', name: 'Cap', unitPriceCents: 1599 }

const saved = (storage: MemoryStorage) => JSON.parse(storage.getItem('cart:v1') ?? 'null')

describe('values are current as soon as a method returns (no component, no flush)', () => {
  test('add, merge and totals', () => {
    const cart = new Cart(new MemoryStorage())
    expect(plain(cart.lines)).toEqual([])
    expect(cart.count).toBe(0)
    expect(cart.subtotalCents).toBe(0)

    cart.add(mug)
    expect(cart.count).toBe(1)
    expect(cart.subtotalCents).toBe(1250)
    cart.add(mug, 2)
    expect(cart.count).toBe(3)
    cart.add(tee)
    expect(cart.count).toBe(4)
    expect(cart.subtotalCents).toBe(3 * 1250 + 2000)
    expect(plain(cart.lines)).toEqual([
      { ...mug, qty: 3 },
      { ...tee, qty: 1 },
    ])
    expect(cart.has('TEE-02')).toBe(true)
    expect(cart.has('CAP-03')).toBe(false)
  })

  test('setQty clamps, floors and removes at zero; remove and clear', () => {
    const cart = new Cart(new MemoryStorage())
    cart.add(mug)
    cart.add(tee)
    cart.add(cap)
    cart.setQty('MUG-01', 250)
    expect(cart.lines.find((l) => l.sku === 'MUG-01')?.qty).toBe(99)
    cart.setQty('TEE-02', 2.7)
    expect(cart.count).toBe(99 + 2 + 1)
    cart.setQty('MUG-01', 0)
    expect(cart.has('MUG-01')).toBe(false)
    expect(cart.subtotalCents).toBe(2 * 2000 + 1599)
    cart.setQty('TEE-02', -3)
    expect(plain(cart.lines)).toEqual([{ ...cap, qty: 1 }])
    cart.remove('CAP-03')
    expect(cart.count).toBe(0)
    cart.add(cap, 5)
    expect(cart.count).toBe(5)
    cart.clear()
    expect(cart.count).toBe(0)
    expect(cart.subtotalCents).toBe(0)
    expect(plain(cart.lines)).toEqual([])
  })

  test('carts are independent', () => {
    const a = new Cart(new MemoryStorage())
    const b = new Cart(new MemoryStorage())
    a.add(mug)
    expect(b.count).toBe(0)
    expect(a.count).toBe(1)
  })

  test('lines is a real array', () => {
    const cart = new Cart(new MemoryStorage())
    cart.add(mug)
    expect(Array.isArray(cart.lines)).toBe(true)
    expect(cart.lines).toHaveLength(1)
    expect(cart.lines[0]!.name).toBe('Mug')
  })
})

describe('persistence', () => {
  test('restores from cart:v1', () => {
    const storage = new MemoryStorage({ 'cart:v1': JSON.stringify([{ ...tee, qty: 2 }]) })
    const cart = new Cart(storage)
    expect(plain(cart.lines)).toEqual([{ ...tee, qty: 2 }])
    expect(cart.count).toBe(2)
    expect(cart.subtotalCents).toBe(4000)
  })

  test('ignores corrupt or unexpected data', () => {
    expect(new Cart(new MemoryStorage({ 'cart:v1': '{nope' })).count).toBe(0)
    expect(new Cart(new MemoryStorage({ 'cart:v1': '{"a":1}' })).count).toBe(0)
  })

  test('saves every change in the same format', async () => {
    const storage = new MemoryStorage()
    const cart = new Cart(storage)
    cart.add(mug)
    await tick()
    expect(saved(storage)).toEqual([{ ...mug, qty: 1 }])

    cart.setQty('MUG-01', 4)
    await tick()
    expect(saved(storage)).toEqual([{ ...mug, qty: 4 }])

    cart.add(tee)
    cart.remove('MUG-01')
    await tick()
    expect(saved(storage)).toEqual([{ ...tee, qty: 1 }])

    cart.clear()
    await tick()
    expect(saved(storage)).toEqual([])
  })

  test('a reloaded cart sees what the previous one saved', async () => {
    const storage = new MemoryStorage()
    const first = new Cart(storage)
    first.add(cap, 3)
    await tick()
    const second = new Cart(storage)
    expect(plain(second.lines)).toEqual([{ ...cap, qty: 3 }])
  })
})
