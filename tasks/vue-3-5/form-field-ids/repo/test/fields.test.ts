import { mount } from '@vue/test-utils'
import { describe, expect, test } from 'vitest'
import CheckboxField from '../src/components/CheckboxField.vue'
import RadioGroup from '../src/components/RadioGroup.vue'
import TextField from '../src/components/TextField.vue'

describe('TextField', () => {
  test('labels the input and wires up the hint and the error', () => {
    const wrapper = mount(TextField, {
      props: { label: 'Email', hint: 'We send receipts here.', error: 'Required.' },
    })
    const input = wrapper.get('input')
    expect(wrapper.get('label').attributes('for')).toBe(input.attributes('id'))
    const described = input.attributes('aria-describedby')!.split(' ')
    expect(described).toEqual([wrapper.get('.field__hint').attributes('id'), wrapper.get('.field__error').attributes('id')])
    expect(input.attributes('aria-invalid')).toBe('true')
  })

  test('supports v-model', async () => {
    const wrapper = mount(TextField, {
      props: { label: 'Name', modelValue: 'Ada', 'onUpdate:modelValue': (v: string) => wrapper.setProps({ modelValue: v }) },
    })
    await wrapper.get('input').setValue('Grace')
    expect(wrapper.props('modelValue')).toBe('Grace')
  })
})

describe('CheckboxField', () => {
  test('labels the checkbox', () => {
    const wrapper = mount(CheckboxField, { props: { label: 'Newsletter', hint: 'Monthly.' } })
    const input = wrapper.get('input')
    expect(wrapper.get('label').attributes('for')).toBe(input.attributes('id'))
    expect(input.attributes('aria-describedby')).toBe(wrapper.get('.field__hint').attributes('id'))
  })
})

describe('RadioGroup', () => {
  test('groups the radios and labels each one', () => {
    const wrapper = mount(RadioGroup, {
      props: { legend: 'Plan', options: [{ value: 'free', label: 'Free' }, { value: 'pro', label: 'Pro' }] },
    })
    const radios = wrapper.findAll('input[type="radio"]')
    expect(new Set(radios.map((r) => r.attributes('name'))).size).toBe(1)
    for (const label of wrapper.findAll('label')) {
      expect(radios.map((r) => r.attributes('id'))).toContain(label.attributes('for'))
    }
  })
})
