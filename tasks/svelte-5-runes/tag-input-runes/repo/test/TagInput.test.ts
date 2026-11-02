import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import TagInput from '../src/lib/TagInput.svelte'
import { chipLabels, click, press, typeInto } from './dom.ts'

let cleanup: (() => void)[] = []
afterEach(() => {
  for (const fn of cleanup.splice(0)) fn()
  document.body.innerHTML = ''
})

function setup(props: Record<string, unknown> = {}) {
  const target = document.body.appendChild(document.createElement('div'))
  const onchange = vi.fn()
  const onreject = vi.fn()
  const app = mount(TagInput, { target, props: { onchange, onreject, ...props } })
  flushSync()
  cleanup.push(() => unmount(app))
  const input = target.querySelector('input')!
  return { target, input, onchange, onreject }
}

describe('TagInput', () => {
  test('renders the initial tags with the default chip', () => {
    const { target } = setup({ tags: ['bug', 'ui'] })
    expect(chipLabels(target)).toEqual(['bug', 'ui'])
    expect(target.querySelector('button[aria-label="Remove ui"]')).not.toBeNull()
    expect(target.querySelector('.hint')?.textContent?.trim()).toBe('8 more allowed')
  })

  test('Enter adds a normalised tag and reports the new list', () => {
    const { target, input, onchange } = setup({ tags: ['bug'] })
    typeInto(input, '  Needs Review ')
    const event = press(input, 'Enter')
    expect(event.defaultPrevented).toBe(true)
    expect(chipLabels(target)).toEqual(['bug', 'needs-review'])
    expect(input.value).toBe('')
    expect(onchange).toHaveBeenCalledTimes(1)
    expect([...onchange.mock.calls[0]![0]]).toEqual(['bug', 'needs-review'])
  })

  test('the remove button drops a tag', () => {
    const { target, onchange } = setup({ tags: ['bug', 'ui'] })
    click(target.querySelector('button[aria-label="Remove bug"]')!)
    expect(chipLabels(target)).toEqual(['ui'])
    expect([...onchange.mock.calls[0]![0]]).toEqual(['ui'])
  })

  test('duplicates are rejected with a reason', () => {
    const { target, input, onchange, onreject } = setup({ tags: ['bug'] })
    typeInto(input, 'BUG')
    press(input, 'Enter')
    expect(chipLabels(target)).toEqual(['bug'])
    expect(onchange).not.toHaveBeenCalled()
    expect(onreject).toHaveBeenCalledWith({ value: 'bug', reason: 'duplicate' })
  })
})
