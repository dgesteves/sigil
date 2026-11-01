import { readFileSync } from 'node:fs'

export interface Item {
  sku: string
  name: string
  priceCents: number
  /** Units on hand per warehouse code, e.g. { LIS: 4, NYC: 7 }. */
  stock: Record<string, number>
}

const dataFile = new URL('../data/inventory.json', import.meta.url)

export function loadInventory(): Item[] {
  return JSON.parse(readFileSync(dataFile, 'utf8')) as Item[]
}

export function totalStock(item: Item): number {
  return Object.values(item.stock).reduce((sum, qty) => sum + qty, 0)
}

export function formatPrice(cents: number): string {
  return `€${(cents / 100).toFixed(2)}`
}
