import { cookies } from 'next/headers'

/** The `cart` cookie looks like `p-100:2,p-300:1` (product id and quantity). */
export function countItems(raw: string | undefined): number {
  if (!raw) return 0
  let total = 0
  for (const entry of raw.split(',')) {
    const quantity = Number(entry.split(':')[1])
    if (Number.isInteger(quantity) && quantity > 0) total += quantity
  }
  return total
}

export async function CartBadge() {
  const cart = (await cookies()).get('cart')?.value
  return (
    <a href="/cart" data-testid="cart">
      Cart ({countItems(cart)})
    </a>
  )
}
