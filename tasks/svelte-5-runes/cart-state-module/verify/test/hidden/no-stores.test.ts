import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'

// The request: the cart and its consumers move off svelte/store.
const files = [
  'src/lib/cart.svelte.ts',
  'src/lib/checkout.ts',
  'src/lib/ProductCard.svelte',
  'src/lib/CartBadge.svelte',
  'src/lib/CartDrawer.svelte',
]

for (const file of files) {
  test(`${file} does not use svelte/store or the old cart module`, () => {
    const source = readFileSync(file, 'utf8')
    expect(source).not.toMatch(/['"]svelte\/store['"]/)
    expect(source).not.toMatch(/from\s+['"]\.\/cart(\.ts|\.js)?['"]/)
  })
}
