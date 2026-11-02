import type { CartLine, Product } from './types.ts'

const STORAGE_KEY = 'cart:v1'
const MAX_QTY = 99

type CartStorage = Pick<Storage, 'getItem' | 'setItem'>

const clamp = (qty: number) => Math.min(MAX_QTY, Math.max(0, Math.floor(qty)))

function load(storage: CartStorage | null): CartLine[] {
  if (!storage) return []
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export class Cart {
  lines = $state<CartLine[]>([])
  count = $derived(this.lines.reduce((n, line) => n + line.qty, 0))
  subtotalCents = $derived(this.lines.reduce((sum, line) => sum + line.qty * line.unitPriceCents, 0))

  #storage: CartStorage | null

  constructor(storage: CartStorage | null = typeof localStorage === 'undefined' ? null : localStorage) {
    this.#storage = storage
    this.lines = load(storage)
  }

  add(product: Product, qty = 1) {
    const existing = this.lines.find((line) => line.sku === product.sku)
    if (existing) existing.qty = clamp(existing.qty + qty)
    else this.lines.push({ ...product, qty: clamp(qty) })
    this.#save()
  }

  /** Sets the quantity of a line; 0 or less removes it. */
  setQty(sku: string, qty: number) {
    const next = clamp(qty)
    if (next === 0) {
      this.remove(sku)
      return
    }
    const line = this.lines.find((l) => l.sku === sku)
    if (line) line.qty = next
    this.#save()
  }

  remove(sku: string) {
    this.lines = this.lines.filter((line) => line.sku !== sku)
    this.#save()
  }

  clear() {
    this.lines = []
    this.#save()
  }

  has(sku: string) {
    return this.lines.some((line) => line.sku === sku)
  }

  #save() {
    // JSON.stringify reads through the state proxies, so this stores plain data.
    this.#storage?.setItem(STORAGE_KEY, JSON.stringify(this.lines))
  }
}

/** The cart the app uses. Tests create their own `new Cart(storage)`. */
export const cart = new Cart()
