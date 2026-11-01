import { derived, get, writable } from 'svelte/store'
import type { CartLine, Product } from './types.ts'

const STORAGE_KEY = 'cart:v1'
const MAX_QTY = 99

function load(): CartLine[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export const lines = writable<CartLine[]>(load())

export const count = derived(lines, ($lines) => $lines.reduce((n, line) => n + line.qty, 0))

export const subtotalCents = derived(lines, ($lines) =>
  $lines.reduce((sum, line) => sum + line.qty * line.unitPriceCents, 0),
)

lines.subscribe(($lines) => {
  if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify($lines))
})

const clamp = (qty: number) => Math.min(MAX_QTY, Math.max(0, Math.floor(qty)))

export function addItem(product: Product, qty = 1) {
  lines.update(($lines) => {
    const existing = $lines.find((line) => line.sku === product.sku)
    if (existing) {
      return $lines.map((line) =>
        line.sku === product.sku ? { ...line, qty: clamp(line.qty + qty) } : line,
      )
    }
    return [...$lines, { ...product, qty: clamp(qty) }]
  })
}

/** Sets the quantity of a line; 0 or less removes it. */
export function setQty(sku: string, qty: number) {
  const next = clamp(qty)
  lines.update(($lines) =>
    next === 0
      ? $lines.filter((line) => line.sku !== sku)
      : $lines.map((line) => (line.sku === sku ? { ...line, qty: next } : line)),
  )
}

export function removeItem(sku: string) {
  lines.update(($lines) => $lines.filter((line) => line.sku !== sku))
}

export function clearCart() {
  lines.set([])
}

export function hasItem(sku: string) {
  return get(lines).some((line) => line.sku === sku)
}
