<script setup lang="ts">
import { ref } from 'vue'
import StockBadge from './StockBadge.vue'

const { variants } = defineProps<{ variants: { sku: string; label: string }[] }>()
const selected = ref(variants[0]?.sku ?? '')
</script>

<template>
  <div class="variant-picker">
    <select v-model="selected" aria-label="Variant">
      <option v-for="v in variants" :key="v.sku" :value="v.sku">{{ v.label }}</option>
    </select>
    <StockBadge :sku="selected" />
  </div>
</template>
