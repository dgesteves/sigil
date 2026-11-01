<script setup lang="ts">
import { computed } from 'vue'
import type { createDraftStore } from '../draftStore.ts'
import TagInput from './TagInput.vue'

const { store } = defineProps<{ store: ReturnType<typeof createDraftStore> }>()

const tags = computed({
  get: () => store.draft.value.tags as string[],
  set: (tags: string[]) => store.update({ tags }),
})
const keywords = computed({
  get: () => store.draft.value.keywords as string[],
  set: (keywords: string[]) => store.update({ keywords }),
})
</script>

<template>
  <form class="article-form" @submit.prevent>
    <fieldset class="article-form__row">
      <legend>Tags</legend>
      <TagInput v-model="tags" placeholder="Add a tag" />
    </fieldset>
    <fieldset class="article-form__row">
      <legend>SEO keywords</legend>
      <TagInput v-model.lowercase="keywords" placeholder="Add a keyword" />
    </fieldset>
  </form>
</template>
