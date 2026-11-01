import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react'

export interface MenuItem {
  id: string
  label: string
  onSelect: () => void
}

export interface MenuButtonProps {
  /** Text of the button that opens the menu, e.g. "Account". */
  label: string
  items: MenuItem[]
}

/**
 * WAI-ARIA APG menu button. The open menu manages focus with a roving tabindex: every item has
 * tabIndex -1 and the active one receives DOM focus. Escape, Enter and Tab close the menu.
 */
export function MenuButton({ label, items }: MenuButtonProps) {
  const id = useId()
  const buttonId = `${id}-button`
  const menuId = `${id}-menu`
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const itemRefs = useRef<(HTMLLIElement | null)[]>([])

  const openAt = (index: number) => {
    setActiveIndex(index)
    setOpen(true)
  }
  const close = ({ restoreFocus }: { restoreFocus: boolean }) => {
    setOpen(false)
    if (restoreFocus) buttonRef.current?.focus()
  }

  // Move DOM focus after React has rendered the item that should receive it.
  useEffect(() => {
    if (open) itemRefs.current[activeIndex]?.focus()
  }, [open, activeIndex])

  // Close when clicking anywhere outside the menu.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  const choose = (item: MenuItem) => {
    close({ restoreFocus: true })
    item.onSelect()
  }

  const onButtonKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    // Enter and Space reach onClick through the native button; the arrows are optional extras.
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      openAt(0)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      openAt(items.length - 1)
    }
  }

  const onMenuKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const last = items.length - 1
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        setActiveIndex((i) => (i === last ? 0 : i + 1))
        break
      case 'ArrowUp':
        event.preventDefault()
        setActiveIndex((i) => (i === 0 ? last : i - 1))
        break
      case 'Home':
        event.preventDefault()
        setActiveIndex(0)
        break
      case 'End':
        event.preventDefault()
        setActiveIndex(last)
        break
      case 'Escape':
        event.preventDefault()
        close({ restoreFocus: true })
        break
      case 'Enter':
      case ' ': {
        event.preventDefault()
        const item = items[activeIndex]
        if (item) choose(item)
        break
      }
      case 'Tab':
        // Let the browser move focus on from the button, as if the menu were never opened.
        buttonRef.current?.focus()
        setOpen(false)
        break
      default:
        // Typeahead: jump to the next item starting with the typed character.
        if (event.key.length === 1 && /\S/.test(event.key)) {
          const char = event.key.toLowerCase()
          const order = items.map((_, i) => (activeIndex + 1 + i) % items.length)
          const match = order.find((i) => items[i]?.label.toLowerCase().startsWith(char))
          if (match !== undefined) setActiveIndex(match)
        }
    }
  }

  return (
    <div className="menu" ref={rootRef}>
      <button
        ref={buttonRef}
        id={buttonId}
        type="button"
        className="menu__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close({ restoreFocus: false }) : openAt(0))}
        onKeyDown={onButtonKeyDown}
      >
        {label} <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <ul
          id={menuId}
          role="menu"
          aria-labelledby={buttonId}
          className="menu__list"
          onKeyDown={onMenuKeyDown}
        >
          {items.map((item, index) => (
            <li
              key={item.id}
              ref={(el) => {
                itemRefs.current[index] = el
              }}
              role="menuitem"
              tabIndex={-1}
              className="menu__item"
              onClick={() => choose(item)}
              onMouseMove={() => {
                if (index !== activeIndex) setActiveIndex(index)
              }}
            >
              {item.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
