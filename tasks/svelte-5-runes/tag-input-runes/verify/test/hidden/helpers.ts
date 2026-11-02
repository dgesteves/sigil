import { flushSync, mount, unmount } from 'svelte'

const mounted: Record<string, unknown>[] = []

export function render(component: any, props: Record<string, unknown> = {}) {
  const target = document.body.appendChild(document.createElement('div'))
  const app = mount(component, { target, props })
  flushSync()
  mounted.push(app)
  return target
}

export function cleanup() {
  for (const app of mounted.splice(0)) unmount(app)
  document.body.innerHTML = ''
}

export function typeInto(input: Element, text: string) {
  ;(input as HTMLInputElement).value = text
  input.dispatchEvent(new Event('input', { bubbles: true }))
  flushSync()
}

export function press(el: Element, key: string) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  el.dispatchEvent(event)
  flushSync()
  return event
}

export function addTag(input: Element, text: string, key = 'Enter') {
  typeInto(input, text)
  return press(input, key)
}

export function click(el: Element | null) {
  if (!el) throw new Error('element to click was not rendered')
  ;(el as HTMLElement).click()
  flushSync()
}

export const chips = (root: Element) =>
  [...root.querySelectorAll('.chips > li')].map((li) => li.textContent?.replace('×', '').trim())

export const hint = (root: Element) => root.querySelector('.hint')?.textContent?.trim()

/** Plain copy of whatever a callback received (arrays may be state proxies). */
export const plain = (value: unknown) => JSON.parse(JSON.stringify(value))
