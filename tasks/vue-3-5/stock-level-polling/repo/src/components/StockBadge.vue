<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { fetchStock, type StockLevel } from '../api.ts'

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

const stock = ref<StockLevel | null>(null)
const error = ref<unknown>(null)

onMounted(async () => {
  try {
    stock.value = await fetchStock(sku, warehouse)
  } catch (err) {
    error.value = err
  }
})

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
