<script setup lang="ts">
import { ref } from 'vue'
import CheckboxField from './components/CheckboxField.vue'
import RadioGroup from './components/RadioGroup.vue'
import TextField from './components/TextField.vue'

const query = ref('')
const sort = ref('relevance')
const inStock = ref(false)
</script>

<template>
  <form class="search-bar" role="search" @submit.prevent>
    <TextField v-model="query" label="Search" type="search" hint="Try an order number." />
    <RadioGroup
      v-model="sort"
      legend="Sort by"
      :options="[
        { value: 'relevance', label: 'Relevance' },
        { value: 'newest', label: 'Newest' },
      ]"
    />
    <CheckboxField v-model="inStock" label="Only in stock" />
  </form>
</template>
