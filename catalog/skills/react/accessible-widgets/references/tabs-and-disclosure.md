# Tabs, disclosure and accordion

## Tabs

Use tabs for layered panels of one view. If each "tab" loads a different URL, it is navigation:
use links with `aria-current="page"` instead.

Contract:

- `role="tablist"` named with `aria-label` or `aria-labelledby`; `aria-orientation="vertical"` when
  the tabs are stacked.
- Each `role="tab"` has `aria-selected` (`"true"` on the selected tab, `"false"` on the others) and
  `aria-controls` pointing at its panel. Each `role="tabpanel"` has `aria-labelledby` pointing at its
  tab.
- One Tab stop: the selected tab has `tabIndex={0}`, the rest `-1`. Tab from the list goes to the
  panel (give the panel `tabIndex={0}` when it has no focusable content near its start).
- Horizontal: Left/Right Arrow move to the previous/next tab and wrap. Vertical: Up/Down. Don't
  handle Up/Down in a horizontal list, so the page can still scroll.
- Home/End (optional, cheap) move to the first/last tab.
- Automatic activation: moving focus selects the tab. Recommended when panels render without delay.
  Manual activation: arrows only move focus; Enter or Space selects. Use it when showing a panel is
  slow (network, heavy render).
- With manual activation, the roving `tabIndex={0}` stays on the *selected* tab, so tabbing back
  into the list lands on it.

```tsx
import { type KeyboardEvent, type ReactNode, useId, useRef, useState } from 'react'

export interface TabSpec {
  key: string
  caption: ReactNode
  body: ReactNode
}

interface TabSetProps {
  accessibleName: string
  panes: TabSpec[]
  selectedKey: string
  onSelectionChange: (key: string) => void
  activation?: 'automatic' | 'manual'
  orientation?: 'horizontal' | 'vertical'
}

export function TabSet(props: TabSetProps) {
  const { accessibleName, panes, selectedKey, onSelectionChange } = props
  const { activation = 'automatic', orientation = 'horizontal' } = props
  const id = useId()
  const refs = useRef(new Map<string, HTMLButtonElement>())
  const [focusedKey, setFocusedKey] = useState(selectedKey)
  const selected = Math.max(
    0,
    panes.findIndex((t) => t.key === selectedKey),
  )

  const focusTab = (index: number) => {
    const tab = panes[index]
    if (!tab) return
    setFocusedKey(tab.key)
    refs.current.get(tab.key)?.focus()
    if (activation === 'automatic' && tab.key !== selectedKey) onSelectionChange(tab.key)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const from = Math.max(
      0,
      panes.findIndex((t) => t.key === focusedKey),
    )
    const [prev, next] =
      orientation === 'horizontal' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown']
    const last = panes.length - 1
    let target: number | undefined
    if (event.key === next) target = from === last ? 0 : from + 1
    else if (event.key === prev) target = from === 0 ? last : from - 1
    else if (event.key === 'Home') target = 0
    else if (event.key === 'End') target = last
    if (target === undefined) return
    event.preventDefault()
    focusTab(target)
  }

  return (
    <div className="tabset">
      <div
        role="tablist"
        aria-label={accessibleName}
        aria-orientation={orientation === 'vertical' ? 'vertical' : undefined}
        onKeyDown={onKeyDown}
      >
        {panes.map((tab, index) => (
          <button
            key={tab.key}
            ref={(el) => {
              if (el) refs.current.set(tab.key, el)
              else refs.current.delete(tab.key)
            }}
            type="button"
            role="tab"
            id={`${id}-handle-${tab.key}`}
            aria-selected={index === selected}
            aria-controls={`${id}-section-${tab.key}`}
            tabIndex={index === selected ? 0 : -1}
            onFocus={() => setFocusedKey(tab.key)}
            // Click, Enter and Space all arrive here because the tab is a native button.
            onClick={() => onSelectionChange(tab.key)}
          >
            {tab.caption}
          </button>
        ))}
      </div>
      {panes.map((tab, index) => (
        <div
          key={tab.key}
          role="tabpanel"
          id={`${id}-section-${tab.key}`}
          aria-labelledby={`${id}-handle-${tab.key}`}
          tabIndex={0}
          hidden={index !== selected}
        >
          {tab.body}
        </div>
      ))}
    </div>
  )
}
```

Notes:

- The component is controlled (`selectedKey` + `onSelectionChange`); keep a `useState` in the parent or
  wrap it for an uncontrolled API.
- All panels stay mounted and `hidden`, so every tab's `aria-controls` resolves. If panels are
  expensive, render only the selected one and set `aria-controls` only on the selected tab.
- `onFocus` keeps `focusedKey` right when focus arrives by mouse or by Tab, so arrows always start
  from the tab that really has focus.
- Using `<button>` for tabs gives Enter/Space activation for free. A `div role="tab"` needs its
  own `tabIndex` and key handling.

Mistakes to avoid: every tab tabbable; arrows changing selection without moving focus; no wrap;
`aria-selected` only on the active tab (set `"false"` on the others); panels without
`aria-labelledby`; Up/Down hijacked in a horizontal tablist.

## Disclosure (show/hide)

```tsx
import { type ReactNode, useId, useState } from 'react'

export function Disclosure({ toggleText, children }: { toggleText: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const regionId = useId()
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={regionId}
        onClick={() => setOpen((o) => !o)}
      >
        {toggleText}
      </button>
      <div id={regionId} hidden={!open}>
        {children}
      </div>
    </>
  )
}
```

- `<details>`/`<summary>` is the zero-JavaScript alternative and is exposed correctly by browsers;
  use it when you don't need to control the state from React (or use its `open` attribute and the
  `toggle` event when you do).
- Don't put headings, links or buttons inside the toggle button; put the button inside the heading
  instead (`<h3><button aria-expanded>…</button></h3>`).

## Accordion

A stack of disclosures, each header a heading that contains only the toggle button:

- `<h3><button aria-expanded={open} aria-controls={regionId} id={headerId}>`; pick the heading level
  that fits the page outline.
- Optionally give each panel `role="region"` and `aria-labelledby={headerId}`. Skip it when more than
  about six panels can be open at once: that many landmarks is noise.
- Enter/Space toggle. Every header button stays in the page Tab sequence; the current APG pattern
  defines no arrow-key navigation between headers, so don't make it a roving-tabindex composite.
- If one panel must always stay open, set `aria-disabled="true"` on the expanded header's button.
