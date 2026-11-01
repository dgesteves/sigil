<script lang="ts">
  import { track } from './analytics.ts'
  import { cart } from './cart.svelte.ts'
  import { formatCents } from './format.ts'
</script>

<aside class="cart-drawer" aria-label="Cart">
  {#if cart.lines.length === 0}
    <p class="empty">Your cart is empty.</p>
  {:else}
    <ul>
      {#each cart.lines as line (line.sku)}
        <li data-sku={line.sku}>
          <span class="name">{line.name}</span>
          <input
            type="number"
            min="0"
            max="99"
            aria-label="Quantity of {line.name}"
            value={line.qty}
            onchange={(event) => cart.setQty(line.sku, Number(event.currentTarget.value))}
          />
          <span class="line-total">{formatCents(line.qty * line.unitPriceCents)}</span>
          <button type="button" aria-label="Remove {line.name}" onclick={() => cart.remove(line.sku)}>
            Remove
          </button>
        </li>
      {/each}
    </ul>
    <p class="subtotal">Subtotal: <strong>{formatCents(cart.subtotalCents)}</strong></p>
    <button
      type="button"
      class="clear"
      onclick={() => {
        track('clear_cart', { lines: cart.lines.length })
        cart.clear()
      }}
    >
      Empty cart
    </button>
  {/if}
</aside>
