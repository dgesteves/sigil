<script setup lang="ts">
import { ref } from 'vue'
import TagInput from '../../src/components/TagInput.vue'

const tags = ref<string[]>(['draft'])
defineExpose({ tags, replace: (next: string[]) => (tags.value = next) })
</script>

<template>
  <TagInput v-model="tags" />
</template>
