<script setup lang="ts">
import { reactive } from 'vue'
import CheckboxField from './components/CheckboxField.vue'
import RadioGroup from './components/RadioGroup.vue'
import TextField from './components/TextField.vue'

const form = reactive({
  name: 'Ada Lovelace',
  email: 'ada@example.org',
  password: '',
  plan: 'pro',
  emailFrequency: 'weekly',
  newsletter: true,
  productUpdates: false,
})
</script>

<template>
  <form class="account-settings" @submit.prevent>
    <h1>Account settings</h1>
    <TextField v-model="form.name" label="Full name" />
    <TextField v-model="form.email" label="Email" type="email" hint="We send receipts here." />
    <TextField
      v-model="form.password"
      label="New password"
      type="password"
      hint="At least 12 characters."
      error="Your password is too short."
    />
    <RadioGroup
      v-model="form.plan"
      legend="Plan"
      :options="[
        { value: 'free', label: 'Free' },
        { value: 'pro', label: 'Pro' },
      ]"
    />
    <RadioGroup
      v-model="form.emailFrequency"
      legend="Email digest"
      :options="[
        { value: 'daily', label: 'Daily' },
        { value: 'weekly', label: 'Weekly' },
      ]"
    />
    <CheckboxField v-model="form.newsletter" label="Newsletter" hint="One email a month." />
    <CheckboxField v-model="form.productUpdates" label="Product updates" />
    <button type="submit">Save</button>
  </form>
</template>
