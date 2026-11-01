<script lang="ts">
  import { count } from './cart.ts'

  let { onopen }: { onopen?: () => void } = $props()
</script>

<button type="button" class="cart-badge" aria-label="Cart, {$count} items" onclick={() => onopen?.()}>
  🛒 <span class="count">{$count}</span>
</button>
