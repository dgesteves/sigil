<script setup lang="ts">
import { useId } from 'vue'

const { label, hint } = defineProps<{ label: string; hint?: string }>()
const checked = defineModel<boolean>({ default: false })

const inputId = useId()
const hintId = `${inputId}-hint`
</script>

<template>
  <div class="field field--checkbox">
    <input
      :id="inputId"
      v-model="checked"
      class="field__checkbox"
      type="checkbox"
      :aria-describedby="hint ? hintId : undefined"
    />
    <label class="field__label" :for="inputId">{{ label }}</label>
    <p v-if="hint" :id="hintId" class="field__hint">{{ hint }}</p>
  </div>
</template>
