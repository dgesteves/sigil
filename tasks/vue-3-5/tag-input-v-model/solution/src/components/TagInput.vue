<script setup lang="ts">
import { ref } from 'vue'

const { placeholder = 'Add a tag' } = defineProps<{ placeholder?: string }>()

// Two-way binding for `v-model` / `v-model.lowercase`. Without v-model on the parent, defineModel
// keeps a local value, so the component still works when it is only listened to. The default is a
// factory so instances never share one array.
const [tags, modifiers] = defineModel<string[], 'lowercase'>({ default: () => [] })

const draft = ref('')

function normalise(raw: string) {
  const tag = raw.trim()
  return modifiers.lowercase ? tag.toLowerCase() : tag
}

function add(raw: string) {
  const tag = normalise(raw)
  if (!tag) return
  const seen = new Set(tags.value.map((t) => t.toLowerCase()))
  if (seen.has(tag.toLowerCase())) return
  // Never mutate the array we were given (the store hands out frozen snapshots): assign a new one.
  tags.value = [...tags.value, tag]
}

function remove(index: number) {
  tags.value = tags.value.filter((_, i) => i !== index)
}

function commitDraft() {
  const pending = draft.value
  draft.value = ''
  add(pending)
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' || event.key === ',') {
    event.preventDefault()
    commitDraft()
  } else if (event.key === 'Backspace' && draft.value === '' && tags.value.length > 0) {
    remove(tags.value.length - 1)
  }
}

// Pasted or autocorrected text can still contain commas.
function onInput() {
  if (!draft.value.includes(',')) return
  const parts = draft.value.split(',')
  draft.value = parts.pop() ?? ''
  for (const part of parts) add(part)
}
</script>

<template>
  <div class="tag-input">
    <ul class="tag-input__list">
      <li v-for="(tag, index) in tags" :key="tag" class="tag-input__tag">
        <span class="tag-input__label">{{ tag }}</span>
        <button type="button" class="tag-input__remove" :aria-label="`Remove ${tag}`" @click="remove(index)">×</button>
      </li>
    </ul>
    <input
      v-model="draft"
      class="tag-input__field"
      type="text"
      :placeholder="placeholder"
      @keydown="onKeydown"
      @input="onInput"
    />
  </div>
</template>
