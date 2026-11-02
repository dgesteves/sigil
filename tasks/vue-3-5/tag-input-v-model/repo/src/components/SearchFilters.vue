<script setup lang="ts">
import TagInput from './TagInput.vue'

const emit = defineEmits<{ change: [filters: { tags: string[] }] }>()

function onTags(tags: string[]) {
  emit('change', { tags })
}
</script>

<template>
  <section class="search-filters">
    <h2>Filter by tag</h2>
    <TagInput placeholder="Filter by tag" @update:model-value="onTags" />
  </section>
</template>
