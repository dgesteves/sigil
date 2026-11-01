<script lang="ts">
let groups = 0
</script>

<script setup lang="ts">
const { legend, options } = defineProps<{
  legend: string
  options: { value: string; label: string }[]
}>()
const selected = defineModel<string>()

groups += 1
const name = `radio-group-${groups}`
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
