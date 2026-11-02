<script setup lang="ts">
import { computed } from 'vue'
import { useStockLevel } from '../composables/useStockLevel.ts'

const {
  sku,
  warehouse = 'main',
  pollMs = 30_000,
} = defineProps<{
  sku: string
  warehouse?: string
  /** How often to refresh while the badge is on screen. */
  pollMs?: number
}>()

// Getters keep the destructured props reactive inside the composable.
const { stock, error } = useStockLevel(
  () => sku,
  () => warehouse,
  { pollMs },
)

const label = computed(() => {
  if (stock.value) {
    return stock.value.available > 0 ? `In stock (${stock.value.available})` : 'Out of stock'
  }
  return error.value ? 'Stock unavailable' : 'Checking stock…'
})
</script>

<template>
  <span class="stock-badge" :data-sku="sku" :data-poll-ms="pollMs">{{ label }}</span>
</template>
