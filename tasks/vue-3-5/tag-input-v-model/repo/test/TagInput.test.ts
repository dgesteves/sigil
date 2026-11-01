import { mount } from '@vue/test-utils'
import { describe, expect, test } from 'vitest'
import TagInput from '../src/components/TagInput.vue'

const labels = (wrapper: ReturnType<typeof mount>) =>
  wrapper.findAll('.tag-input__label').map((el) => el.text())

describe('TagInput', () => {
  test('renders the tags it is given', () => {
    const wrapper = mount(TagInput, { props: { modelValue: ['vue', 'vite'] } })
    expect(labels(wrapper)).toEqual(['vue', 'vite'])
    expect(wrapper.find('button[aria-label="Remove vite"]').exists()).toBe(true)
  })

  test('uses the placeholder', () => {
    const wrapper = mount(TagInput, { props: { placeholder: 'Add a keyword' } })
    expect(wrapper.find('input.tag-input__field').attributes('placeholder')).toBe('Add a keyword')
  })
})
