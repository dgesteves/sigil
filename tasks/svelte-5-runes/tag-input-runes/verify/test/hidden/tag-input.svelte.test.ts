import { flushSync } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import TagInput from '../../src/lib/TagInput.svelte'
import BindHarness from './BindHarness.svelte'
import ChipHarness from './ChipHarness.svelte'
import { addTag, chips, cleanup, click, hint, plain, press, render, typeInto } from './helpers.ts'

afterEach(cleanup)

describe('props and derived values', () => {
  test('the hint follows max and tags when the parent changes them', () => {
    const props = $state({ tags: ['a', 'b'], max: 3 })
    const root = render(TagInput, props)
    expect(hint(root)).toBe('1 more allowed')

    props.max = 5
    flushSync()
    expect(hint(root)).toBe('3 more allowed')

    props.tags = ['x']
    flushSync()
    expect(chips(root)).toEqual(['x'])
    expect(hint(root)).toBe('4 more allowed')

    props.max = 1
    flushSync()
    expect(hint(root)).toBe('Label limit reached')
  })

  test('defaults: no tags, ten allowed, default placeholder', () => {
    const root = render(TagInput)
    expect(chips(root)).toEqual([])
    expect(hint(root)).toBe('10 more allowed')
    expect(root.querySelector('input')!.getAttribute('placeholder')).toBe('Add a label')
  })

  test('other attributes are forwarded to the input', () => {
    const root = render(TagInput, { 'aria-label': 'Labels', name: 'labels', id: 'issue-labels' })
    const input = root.querySelector('input')!
    expect(input.getAttribute('aria-label')).toBe('Labels')
    expect(input.getAttribute('name')).toBe('labels')
    expect(input.id).toBe('issue-labels')
  })
})

describe('keyboard and callbacks', () => {
  test('comma also adds, Backspace on an empty draft removes the last tag', () => {
    const onchange = vi.fn()
    const root = render(TagInput, { tags: ['bug'], onchange })
    const input = root.querySelector('input')!
    expect(addTag(input, 'Docs', ',').defaultPrevented).toBe(true)
    expect(chips(root)).toEqual(['bug', 'docs'])

    typeInto(input, 'x')
    press(input, 'Backspace')
    expect(chips(root)).toEqual(['bug', 'docs'])

    typeInto(input, '')
    press(input, 'Backspace')
    expect(chips(root)).toEqual(['bug'])
    expect(onchange.mock.calls.map(([tags]) => plain(tags))).toEqual([['bug', 'docs'], ['bug']])
  })

  test('callbacks receive plain values, not events', () => {
    const onchange = vi.fn()
    const onreject = vi.fn()
    const root = render(TagInput, { tags: ['a', 'b'], max: 2, onchange, onreject })
    const input = root.querySelector('input')!
    expect(hint(root)).toBe('Label limit reached')

    addTag(input, 'c')
    expect(onreject).toHaveBeenLastCalledWith({ value: 'c', reason: 'full' })
    addTag(input, '   ')
    expect(onreject).toHaveBeenLastCalledWith({ value: '', reason: 'empty' })
    expect(chips(root)).toEqual(['a', 'b'])
    expect(onchange).not.toHaveBeenCalled()

    click(root.querySelector('button[aria-label="Remove a"]'))
    expect(onchange).toHaveBeenCalledTimes(1)
    const [arg] = onchange.mock.calls[0]!
    expect(Array.isArray(arg)).toBe(true)
    expect(plain(arg)).toEqual(['b'])
  })
})

describe('bind:tags', () => {
  test('adding and removing in the child updates the bound parent state', () => {
    const root = render(BindHarness)
    const input = root.querySelector('input')!
    addTag(input, 'UI')
    expect(root.querySelector('output')!.textContent).toBe('bug,ui')

    press(input, 'Backspace')
    expect(root.querySelector('output')!.textContent).toBe('bug')

    click(root.querySelector('button[aria-label="Remove bug"]'))
    expect(root.querySelector('output')!.textContent).toBe('')
  })

  test('a parent reassignment reaches the child', () => {
    const root = render(BindHarness, { max: 2 })
    addTag(root.querySelector('input')!, 'ui')
    expect(hint(root)).toBe('Label limit reached')
    click(root.querySelector('.parent-reset'))
    expect(chips(root)).toEqual([])
    expect(hint(root)).toBe('2 more allowed')
  })
})

describe('chip snippet', () => {
  test('renders the custom chip with a working remove function', () => {
    const onchange = vi.fn()
    const root = render(ChipHarness, { onchange })
    expect([...root.querySelectorAll('em.custom')].map((e) => e.textContent)).toEqual(['alpha', 'beta'])
    expect(root.querySelector('button[aria-label^="Remove"]')).toBeNull()

    click([...root.querySelectorAll('button.drop')].find((b) => b.textContent === 'drop beta')!)
    expect([...root.querySelectorAll('em.custom')].map((e) => e.textContent)).toEqual(['alpha'])
    expect(plain(onchange.mock.calls[0]![0])).toEqual(['alpha'])
  })
})
