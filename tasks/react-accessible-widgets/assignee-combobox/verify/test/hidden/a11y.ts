import { act, waitFor } from '@testing-library/react'
import axe from 'axe-core'

/** axe-core WCAG A/AA rules. Colour contrast needs real layout, which jsdom does not have. */
export async function axeViolations(root: Element = document.body): Promise<string[]> {
  const result = await axe.run(root, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
    rules: { 'color-contrast': { enabled: false } },
  })
  return result.violations.map(
    (v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`,
  )
}

/**
 * The element assistive technology treats as focused: DOM focus, or the element referenced by
 * aria-activedescendant on the focused element. Both focus strategies are valid.
 */
export function effectiveFocus(): HTMLElement | null {
  const active = document.activeElement as HTMLElement | null
  if (!active || active === document.body) return null
  const id = active.getAttribute('aria-activedescendant')
  if (id) return document.getElementById(id)
  return active
}

export const label = (el: Element | null) => el?.textContent?.trim() ?? null

/**
 * Lets pending timers and animation frames run. Moving focus after a frame or a timeout is valid,
 * so every check is made on settled state, which also keeps results deterministic.
 */
export const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 50)))

/** Settles, then checks the assertion (with a short retry for slower async updates). */
export async function eventually(assertion: () => void) {
  await settle()
  await waitFor(assertion, { timeout: 1000 })
}
