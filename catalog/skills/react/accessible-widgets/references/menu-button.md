# Menu button

An action menu behind a button: "Row actions", "More actions", a row's kebab menu. Not site navigation:
a nav dropdown of links is a disclosure (button + list of links), because `role="menu"` switches
screen readers into application mode and changes how links are announced and operated.

## Contract

Button:

- `<button type="button">` with `aria-haspopup="menu"` (or `"true"`) and `aria-expanded` set to
  `true` while the menu is shown and `false` while hidden. `aria-controls` to the menu is optional.
- Enter and Space open the menu and focus the first item. A native button turns both into `click`,
  so opening in `onClick` covers them. Down Arrow (optional) opens on the first item, Up Arrow
  (optional) on the last.

Menu:

- `role="menu"`, named by the button (`aria-labelledby={triggerId}`) or `aria-label`.
- Items are `menuitem`, `menuitemcheckbox` (with `aria-checked`) or `menuitemradio`, direct children
  of the menu or separated only by elements with `role="none"`/`"presentation"` or
  `role="group"`/`"separator"`.
- Items are not Tab stops: `tabIndex={-1}` with roving focus, or no tabindex at all with
  `aria-activedescendant` on the menu.
- Down/Up Arrow: next/previous item. Wrapping from last to first is optional; Home/End are required
  when you don't wrap, and cheap to add when you do.
- Enter activates the item and closes the menu, and focus returns to the button. Space may do the
  same (and toggles `menuitemcheckbox`/`menuitemradio` without closing).
- Escape closes the menu and returns focus to the button.
- Tab and Shift+Tab close the menu; focus continues from the button as if the menu was never open.
- Printable characters (optional typeahead) move to the next item whose label starts with them.
- Disabled items: `aria-disabled="true"`, still focusable with the arrows, not activatable.
- Clicking outside closes the menu without moving focus.

## Reference implementation (roving tabindex)

```tsx
import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react'

export interface Action {
  id: string
  text: string
  disabled?: boolean
}

interface ActionMenuProps {
  /** Button content. Its text is the menu's accessible name. */
  children: ReactNode
  actions: Action[]
  onAction: (id: string) => void
}

export function ActionMenu({ children, actions, onAction }: ActionMenuProps) {
  const id = useId()
  const triggerId = `${id}-trigger`
  const popupId = `${id}-actions`
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const entryRefs = useRef<(HTMLLIElement | null)[]>([])
  const last = actions.length - 1

  const show = (index: number) => {
    setActive(index)
    setOpen(true)
  }
  const hide = (returnFocus: boolean) => {
    setOpen(false)
    if (returnFocus) triggerRef.current?.focus()
  }
  const run = (action: Action) => {
    if (action.disabled) return
    hide(true)
    onAction(action.id)
  }

  // Focus follows `active` once the item is rendered. Effects from key presses and clicks are
  // flushed before the next event, so no timers are needed.
  useEffect(() => {
    if (open) entryRefs.current[active]?.focus()
  }, [open, active])

  useEffect(() => {
    if (!open) return
    const onOutsidePointer = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onOutsidePointer)
    return () => document.removeEventListener('pointerdown', onOutsidePointer)
  }, [open])

  const onListKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const action = actions[active]
    switch (event.key) {
      case 'ArrowDown':
        setActive(active === last ? 0 : active + 1)
        break
      case 'ArrowUp':
        setActive(active === 0 ? last : active - 1)
        break
      case 'Home':
        setActive(0)
        break
      case 'End':
        setActive(last)
        break
      case 'Escape':
        hide(true)
        break
      case 'Enter':
      case ' ':
        if (action) run(action)
        break
      case 'Tab':
        // No preventDefault: focus the button, then the browser's Tab moves on from there.
        triggerRef.current?.focus()
        setOpen(false)
        return
      default: {
        if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return
        const letter = event.key.toLowerCase()
        for (let offset = 1; offset <= actions.length; offset++) {
          const index = (active + offset) % actions.length
          if (actions[index]?.text.toLowerCase().startsWith(letter)) {
            setActive(index)
            break
          }
        }
      }
    }
    event.preventDefault()
  }

  return (
    <div ref={wrapperRef} className="action-menu">
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? popupId : undefined}
        onClick={() => (open ? hide(false) : show(0))}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            show(event.key === 'ArrowDown' ? 0 : last)
          }
        }}
      >
        {children}
      </button>
      {open && (
        <ul id={popupId} role="menu" aria-labelledby={triggerId} onKeyDown={onListKeyDown}>
          {actions.map((action, index) => (
            <li
              key={action.id}
              ref={(el) => {
                entryRefs.current[index] = el
              }}
              role="menuitem"
              tabIndex={-1}
              aria-disabled={action.disabled || undefined}
              onClick={() => run(action)}
              onPointerMove={() => {
                if (index !== active) setActive(index)
              }}
            >
              {action.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

Notes on the choices:

- `aria-disabled` is omitted (not `"false"`) on enabled items; that's fine because, unlike
  `aria-expanded`, its absence means "enabled".
- The menu is unmounted when closed, so a closed menu is neither read nor tabbable, and
  `aria-controls` is only set while the menu exists.
- Opening from `onClick` covers Enter and Space on the native button. If you also open on Enter in
  `onKeyDown`, call `preventDefault()` there, or the button's own click toggles the menu shut again.
- Hover moves the roving focus too, so mouse and keyboard never disagree about the active item.

## Variant: `aria-activedescendant`

Put DOM focus on the menu container and point at the active item instead of focusing it:

```tsx
<ul
  ref={popupRef}
  id={popupId}
  role="menu"
  tabIndex={-1}
  aria-labelledby={triggerId}
  aria-activedescendant={`${id}-action-${active}`}
  onKeyDown={onListKeyDown}
  onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false)
  }}
>
  {actions.map((action, index) => (
    <li key={action.id} id={`${id}-action-${index}`} role="menuitem" data-active={index === active}>
      {action.text}
    </li>
  ))}
</ul>
```

Focus `popupRef` in the open effect, style `[data-active="true"]` yourself (there is no `:focus` on
the item), and call `scrollIntoView({ block: 'nearest' })` on the active item when the list can
scroll. With this variant Tab leaves from the menu container, and the `onBlur` above closes it.

## Common mistakes this contract rules out

- Opening the menu without moving focus into it: the user presses Down Arrow and the page scrolls.
- Losing focus on close: Escape or Enter unmounts the focused item, focus falls to `<body>`, and the
  next Tab starts from the top of the page.
- `aria-expanded={open || undefined}`: the closed button no longer says it can expand.
- Buttons as items without `tabIndex={-1}`: Tab walks through every item.
- `li` wrappers around `role="menuitem"` buttons: a `listitem` between `menu` and `menuitem`
  breaks the required ownership (axe reports `aria-required-children`, `aria-required-parent` and
  `listitem`). Use `role="none"` on the `li`, or make the `li` the menuitem.
- Leaving the menu open after Tab.
- Using `role="menu"` for a site's navigation links.
