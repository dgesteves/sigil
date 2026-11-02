<script setup lang="ts">
import { computed, useId } from 'vue'

const {
  label,
  hint,
  error,
  type = 'text',
} = defineProps<{
  label: string
  hint?: string
  error?: string
  type?: 'text' | 'email' | 'password' | 'search'
}>()
const value = defineModel<string>({ default: '' })

// Stable between the server render and hydration, unique per instance.
const inputId = useId()
const hintId = `${inputId}-hint`
const errorId = `${inputId}-error`

const describedBy = computed(
  () => [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined,
)
</script>

<template>
  <div class="field">
    <label class="field__label" :for="inputId">{{ label }}</label>
    <input
      :id="inputId"
      v-model="value"
      class="field__input"
      :type="type"
      :aria-describedby="describedBy"
      :aria-invalid="error ? 'true' : undefined"
    />
    <p v-if="hint" :id="hintId" class="field__hint">{{ hint }}</p>
    <p v-if="error" :id="errorId" class="field__error">{{ error }}</p>
  </div>
</template>
