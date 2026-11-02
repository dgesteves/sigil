import { tick } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { createFeedbackWidget, type WidgetHandle } from '../src/embed.ts'

let handles: WidgetHandle[] = []
afterEach(() => {
  for (const h of handles.splice(0)) h.destroy()
  document.body.innerHTML = ''
})

function host() {
  return document.body.appendChild(document.createElement('div'))
}

function create(...args: Parameters<typeof createFeedbackWidget>) {
  const handle = createFeedbackWidget(...args)
  handles.push(handle)
  return handle
}

describe('createFeedbackWidget', () => {
  test('renders into the host element', async () => {
    const target = host()
    create(target, { title: 'How was checkout?' })
    await tick()
    expect(target.querySelector('h2')?.textContent).toBe('How was checkout?')
    expect(target.querySelectorAll('[role="radio"]')).toHaveLength(5)
  })

  test('submits the rating and the trimmed comment', async () => {
    const onSubmit = vi.fn()
    const target = host()
    create(target, { onSubmit })
    await tick()
    target.querySelector<HTMLButtonElement>('[aria-label="4 out of 5"]')!.click()
    const comment = target.querySelector('textarea')!
    comment.value = '  Quick and easy '
    comment.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()
    target.querySelector<HTMLButtonElement>('button[type="submit"]')!.click()
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0]![0]).toEqual({ rating: 4, comment: 'Quick and easy' })
  })

  test('destroy removes the widget', async () => {
    const target = host()
    const widget = createFeedbackWidget(target)
    await tick()
    widget.destroy()
    expect(target.innerHTML).toBe('')
  })
})
