<script lang="ts">
  import { cart } from './cart.svelte.ts'

  let { onopen }: { onopen?: () => void } = $props()
</script>

<button type="button" class="cart-badge" aria-label="Cart, {cart.count} items" onclick={() => onopen?.()}>
  🛒 <span class="count">{cart.count}</span>
</button>
