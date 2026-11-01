import { tick } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { createFeedbackWidget, type WidgetHandle } from '../../src/embed.ts'

const live: WidgetHandle[] = []
afterEach(() => {
  for (const h of live.splice(0)) {
    try {
      h.destroy()
    } catch {}
  }
  document.body.innerHTML = ''
})

function host() {
  return document.body.appendChild(document.createElement('div'))
}

function create(target: HTMLElement, options?: Parameters<typeof createFeedbackWidget>[1]) {
  const handle = createFeedbackWidget(target, options)
  live.push(handle)
  return handle
}

function typeComment(target: HTMLElement, text: string) {
  const comment = target.querySelector('textarea')!
  comment.value = text
  comment.dispatchEvent(new Event('input', { bubbles: true }))
}

const escape = () =>
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

describe('ready when createFeedbackWidget returns', () => {
  test('onReady has fired exactly once, with the widget in the page', async () => {
    const target = host()
    const markupAtReady: boolean[] = []
    const onReady = vi.fn(() => markupAtReady.push(target.querySelector('form textarea') !== null))
    create(target, { onReady })
    expect(onReady).toHaveBeenCalledTimes(1)
    expect(markupAtReady).toEqual([true])
    await tick()
    expect(onReady).toHaveBeenCalledTimes(1)
  })

  test('autofocus has moved focus to the comment box', () => {
    const target = host()
    create(target, { autofocus: true })
    expect(document.activeElement).toBe(target.querySelector('textarea'))
  })

  test('without autofocus the focus stays where it was', async () => {
    const outside = document.body.appendChild(document.createElement('input'))
    outside.focus()
    create(host(), {})
    await tick()
    expect(document.activeElement).toBe(outside)
  })

  test('the markup is there synchronously', () => {
    const target = host()
    create(target, { title: 'Rate your delivery' })
    expect(target.querySelector('h2')?.textContent).toBe('Rate your delivery')
  })
})

describe('update', () => {
  test('changes the title and placeholder in place, keeping what was typed', async () => {
    const target = host()
    const widget = create(target, { title: 'First', placeholder: 'Say more' })
    await tick()
    typeComment(target, 'half-written thought')
    target.querySelector<HTMLButtonElement>('[aria-label="2 out of 5"]')!.click()
    await tick()
    const textarea = target.querySelector('textarea')!

    widget.update({ title: 'Second' })
    await tick()
    expect(target.querySelector('h2')?.textContent).toBe('Second')
    expect(target.querySelector('textarea')).toBe(textarea)
    expect(textarea.value).toBe('half-written thought')
    expect(textarea.getAttribute('placeholder')).toBe('Say more')
    expect(target.querySelector('[aria-label="2 out of 5"]')?.getAttribute('aria-checked')).toBe('true')

    widget.update({ placeholder: 'Anything else?' })
    await tick()
    expect(textarea.getAttribute('placeholder')).toBe('Anything else?')
    expect(target.querySelector('h2')?.textContent).toBe('Second')
    expect(target.querySelectorAll('form')).toHaveLength(1)
  })

  test('updates one widget without touching another', async () => {
    const a = host()
    const b = host()
    const first = create(a, { title: 'A' })
    create(b, { title: 'B' })
    first.update({ title: 'A2' })
    await tick()
    expect(a.querySelector('h2')?.textContent).toBe('A2')
    expect(b.querySelector('h2')?.textContent).toBe('B')
  })
})

describe('callbacks and methods', () => {
  test('onSubmit receives the feedback object', async () => {
    const onSubmit = vi.fn()
    const target = host()
    create(target, { onSubmit })
    await tick()
    target.querySelector<HTMLButtonElement>('[aria-label="5 out of 5"]')!.click()
    typeComment(target, ' Loved it ')
    await tick()
    target.querySelector<HTMLButtonElement>('button[type="submit"]')!.click()
    expect(onSubmit).toHaveBeenCalledWith({ rating: 5, comment: 'Loved it' })
  })

  test('Escape and the close button call onClose', async () => {
    const onClose = vi.fn()
    const target = host()
    create(target, { onClose })
    await tick()
    escape()
    target.querySelector<HTMLButtonElement>('button.close')!.click()
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  test('reset clears the rating and the comment; focus focuses the comment box', async () => {
    const target = host()
    const widget = create(target)
    await tick()
    target.querySelector<HTMLButtonElement>('[aria-label="3 out of 5"]')!.click()
    typeComment(target, 'typo')
    await tick()
    widget.reset()
    await tick()
    expect(target.querySelector('textarea')!.value).toBe('')
    expect(target.querySelector('[aria-checked="true"]')).toBeNull()
    widget.focus()
    expect(document.activeElement).toBe(target.querySelector('textarea'))
  })
})

describe('destroy', () => {
  test('removes the markup and the window listener', async () => {
    const onClose = vi.fn()
    const onSubmit = vi.fn()
    const target = host()
    const widget = createFeedbackWidget(target, { onClose, onSubmit })
    await tick()
    widget.destroy()
    expect(target.innerHTML).toBe('')
    expect(onClose).not.toHaveBeenCalled()
    escape()
    await tick()
    expect(onClose).not.toHaveBeenCalled()
  })

  test('a destroyed widget does not affect a new one in the same element', async () => {
    const target = host()
    createFeedbackWidget(target, { title: 'Old' }).destroy()
    create(target, { title: 'New' })
    await tick()
    expect(target.querySelectorAll('form')).toHaveLength(1)
    expect(target.querySelector('h2')?.textContent).toBe('New')
  })
})
