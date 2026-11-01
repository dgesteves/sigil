<script>
// Ported as-is from the Vue 2 editor (components/TagInput.vue).
export default {
  name: 'TagInput',
  props: {
    value: { type: Array, default: () => [] },
    placeholder: { type: String, default: 'Add a tag' },
  },
  data() {
    return { draft: '' }
  },
  methods: {
    add() {
      const tag = this.draft.trim()
      this.draft = ''
      if (!tag || this.value.includes(tag)) return
      this.value.push(tag)
      this.$emit('input', this.value)
    },
    remove(index) {
      this.value.splice(index, 1)
      this.$emit('input', this.value)
    },
    onKeydown(event) {
      if (event.key === 'Enter') {
        event.preventDefault()
        this.add()
      } else if (event.key === 'Backspace' && this.draft === '' && this.value.length) {
        this.remove(this.value.length - 1)
      }
    },
  },
}
</script>

<template>
  <div class="tag-input">
    <ul class="tag-input__list">
      <li v-for="(tag, index) in value" :key="tag" class="tag-input__tag">
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
    />
  </div>
</template>
