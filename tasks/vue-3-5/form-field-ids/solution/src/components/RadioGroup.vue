<script setup lang="ts">
import { useId } from 'vue'

const { legend, options } = defineProps<{
  legend: string
  options: { value: string; label: string }[]
}>()
const selected = defineModel<string>()

const name = useId()
</script>

<template>
  <fieldset class="radio-group">
    <legend>{{ legend }}</legend>
    <div v-for="option in options" :key="option.value" class="radio-group__option">
      <input
        :id="`${name}-${option.value}`"
        v-model="selected"
        type="radio"
        :name="name"
        :value="option.value"
      />
      <label :for="`${name}-${option.value}`">{{ option.label }}</label>
    </div>
  </fieldset>
</template>
