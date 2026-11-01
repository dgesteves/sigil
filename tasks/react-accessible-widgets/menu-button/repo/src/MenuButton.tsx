import { useEffect, useRef, useState } from 'react'

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

export function MenuButton({ label, items }: MenuButtonProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  // Close when clicking anywhere outside the menu.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  return (
    <div className="menu" ref={rootRef}>
      <button type="button" className="menu__trigger" onClick={() => setOpen((o) => !o)}>
        {label} <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <ul className="menu__list">
          {items.map((item) => (
            <li
              key={item.id}
              className="menu__item"
              onClick={() => {
                item.onSelect()
                setOpen(false)
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
