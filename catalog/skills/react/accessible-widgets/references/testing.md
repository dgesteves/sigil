# Testing accessible widgets (Testing Library, user-event, axe-core, jsdom)

Checked with React 19.3, @testing-library/react 16.3, @testing-library/user-event 14.6, jsdom 30.1,
Vitest 5.0 and axe-core 4.14.

## What to assert

Assert the contract a keyboard or screen reader user meets, never implementation details:

1. **Roles and names**: `getByRole('tab', { name: 'Activity' })`. A missing role or name fails
   loudly; class names and test ids prove nothing about accessibility.
2. **State attributes**: `getAttribute('aria-expanded')` is `'true'`/`'false'`; `aria-selected` on
   the right element only; every IDREF resolves with `document.getElementById`.
3. **Focus**: after each key, which element is focused. Accept both focus strategies by asking for
   the effectively focused element (below).
4. **Visibility**: `isInaccessible(el)` from `@testing-library/dom` (true for `hidden`,
   `display: none`, `aria-hidden`), or `*ByRole` queries, which skip inaccessible elements by
   default. `getByText` does not skip hidden elements.
5. **Machine-checkable rules**: axe-core in open and closed states.

```ts
import { act, waitFor } from '@testing-library/react'
import axe from 'axe-core'

/** DOM focus, or the element its aria-activedescendant points at. */
export function effectiveFocus(): HTMLElement | null {
  const active = document.activeElement as HTMLElement | null
  if (!active || active === document.body) return null
  const id = active.getAttribute('aria-activedescendant')
  return id ? document.getElementById(id) : active
}

/** Let timers and animation frames run, so deferred focus moves are judged on settled state. */
export const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 50)))

export async function expectEventually(assertion: () => void) {
  await settle()
  await waitFor(assertion, { timeout: 1000 })
}

export async function axeViolations(root: Element = document.body) {
  const result = await axe.run(root, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
    rules: { 'color-contrast': { enabled: false } }, // needs layout; jsdom has none
  })
  return result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`)
}
```

A typical keyboard test:

```tsx
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test } from 'vitest'

afterEach(cleanup) // needed unless Vitest runs with globals: true

test('Escape closes the menu and returns focus to the button', async () => {
  const user = userEvent.setup()
  render(<ActionMenu actions={rowActions} onAction={() => {}}>Row actions</ActionMenu>)
  const button = screen.getByRole('button', { name: 'Row actions' })
  button.focus()
  await user.keyboard('{Enter}')
  await expectEventually(() => expect(effectiveFocus()?.textContent).toBe('Duplicate'))
  await user.keyboard('{Escape}')
  await expectEventually(() => expect(document.activeElement).toBe(button))
  expect(button.getAttribute('aria-expanded')).toBe('false')
  expect(screen.queryByRole('menu')).toBeNull()
  expect(await axeViolations()).toEqual([])
})
```

## Facts that change how tests behave

- `getByLabelText(text)` matches every element labelled by that text (through `<label>`,
  `aria-labelledby` or `aria-label`) and throws when there are several, e.g. an input and a listbox
  sharing one label. `getByRole(role, { name })` is unambiguous.
- `userEvent.setup()` once per test, before `render`. `user.keyboard('{ArrowDown}')`,
  `user.keyboard(' ')` for Space, `user.tab()`, `user.tab({ shift: true })`.
- Pressing Enter or Space on a `<button>` in user-event fires `click`, as browsers do, so a handler on
  `onClick` sees keyboard activation.
- user-event's Tab picks the next element from its own focusable selector and `tabindex` order. It
  ignores `inert` and treats `document.body` as a stop. It respects `preventDefault()` on the Tab
  `keydown`.
- React flushes effects caused by a key press or click synchronously, so focus moved in a
  `useEffect` is visible right after `await user.keyboard(...)`. Focus moved in
  `requestAnimationFrame` is not; wait for it (`settle()` above) instead of asserting immediately.
- Testing Library only cleans up between tests automatically when the runner exposes a global
  `afterEach`. With Vitest's default `globals: false`, call `cleanup` yourself.
- On the client React does not write the `autofocus` attribute; it calls `focus()` at mount. A test
  that checks `hasAttribute('autofocus')` after a client render fails even though focus worked.

## jsdom gaps (jsdom 30.1)

| Missing | Effect | What to do |
| --- | --- | --- |
| `HTMLDialogElement.showModal()` / `close()` | calling them throws `TypeError` | test native dialogs in a browser; in jsdom stub them only to avoid crashes |
| Popover API (`showPopover`, `popovertarget`) | popovers never open or close | browser tests |
| `Element.scrollIntoView`, `scrollTo`, `scrollBy` | calling them throws | stub as no-ops in the test setup |
| `window.matchMedia`, `ResizeObserver` | throw / undefined | stub in the test setup |
| Layout (sizes, positions, colour) | contrast and visibility-by-CSS checks are meaningless | disable `color-contrast`; hide with `hidden` rather than CSS when you want jsdom to see it |

Stubs for the setup file (they fill environment gaps without changing what you test):

```ts
const noop = () => {}
const proto = Element.prototype as unknown as Record<string, unknown>
for (const name of ['scrollIntoView', 'scrollTo', 'scrollBy']) proto[name] ??= noop
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
}
```

## What axe-core catches here (and what it doesn't)

Catches, under jsdom: missing required attributes (an expanded `combobox` without `aria-controls`,
a combobox without `aria-expanded`), IDREFs to missing elements (`aria-activedescendant`), broken
ownership (`li` wrappers between `menu` and `menuitem`, a `tab` outside a `tablist`), attributes not
allowed on a role (`aria-selected` on a `menuitem`), unnamed form fields.

Doesn't catch: keyboard behaviour, focus order, focus return, whether a highlight is exposed, a
`div` with `onClick` and no role (it has no semantics to check), an unnamed `menu` or `listbox`.
Those need the keyboard tests above, and ideally a manual pass with a screen reader.

## Beyond jsdom

For native `<dialog>`, popover, real focus order and scrolling, run the same tests in a browser:
Vitest browser mode or Playwright with `page.keyboard.press('ArrowDown')`, `toBeFocused()` and
`getByRole`. Spot-check with a screen reader (VoiceOver + Safari, NVDA + Firefox or Chrome) before
shipping a new widget.
