import { flushSync } from 'svelte'

export function typeInto(input: HTMLInputElement, text: string) {
  input.value = text
  input.dispatchEvent(new Event('input', { bubbles: true }))
  flushSync()
}

export function press(el: Element, key: string) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  el.dispatchEvent(event)
  flushSync()
  return event
}

export function click(el: Element) {
  ;(el as HTMLElement).click()
  flushSync()
}

export const chipLabels = (root: Element) =>
  [...root.querySelectorAll('.chips > li')].map((li) => li.textContent?.replace('×', '').trim())
