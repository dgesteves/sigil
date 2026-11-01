<script lang="ts">
  import { track } from './analytics.ts'
  import { cart } from './cart.svelte.ts'
  import { formatCents } from './format.ts'
  import type { Product } from './types.ts'

  let { product }: { product: Product } = $props()

  const inCart = $derived(cart.lines.find((line) => line.sku === product.sku)?.qty ?? 0)

  function add() {
    cart.add(product)
    // the cart size after this add, for the funnel dashboards
    track('add_to_cart', { sku: product.sku, cartCount: cart.count })
  }
</script>

<article class="product" data-sku={product.sku}>
  <h3>{product.name}</h3>
  <p class="price">{formatCents(product.unitPriceCents)}</p>
  <button type="button" onclick={add}>
    {inCart ? `Add another (${inCart} in cart)` : 'Add to cart'}
  </button>
</article>
