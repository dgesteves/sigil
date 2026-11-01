import { type KeyboardEvent, type ReactNode, useId, useRef, useState } from 'react'

export interface TabItem {
  id: string
  title: string
  content: ReactNode
}

export interface TabsProps {
  /** Name of the whole tab set, e.g. "Invoice sections". */
  label: string
  tabs: TabItem[]
  defaultSelectedId?: string
  onChange?: (id: string) => void
}

/**
 * WAI-ARIA APG tabs pattern with automatic activation: the selected tab is the only tab stop
 * (roving tabindex), arrows move focus and selection together, Home/End jump to the ends.
 */
export function Tabs({ label, tabs, defaultSelectedId, onChange }: TabsProps) {
  const baseId = useId()
  const [selectedId, setSelectedId] = useState(defaultSelectedId ?? tabs[0]?.id)
  const tabRefs = useRef(new Map<string, HTMLButtonElement>())
  const selectedIndex = Math.max(
    0,
    tabs.findIndex((tab) => tab.id === selectedId),
  )

  const select = (index: number) => {
    const tab = tabs[index]
    if (!tab) return
    tabRefs.current.get(tab.id)?.focus()
    if (tab.id !== tabs[selectedIndex]?.id) {
      setSelectedId(tab.id)
      onChange?.(tab.id)
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const last = tabs.length - 1
    const next: Record<string, number> = {
      ArrowRight: selectedIndex === last ? 0 : selectedIndex + 1,
      ArrowLeft: selectedIndex === 0 ? last : selectedIndex - 1,
      Home: 0,
      End: last,
    }
    const target = next[event.key]
    if (target === undefined) return
    event.preventDefault()
    select(target)
  }

  return (
    <div className="tabs">
      <div role="tablist" aria-label={label} className="tabs__list" onKeyDown={onKeyDown}>
        {tabs.map((tab, index) => {
          const selected = index === selectedIndex
          return (
            <button
              key={tab.id}
              ref={(el) => {
                if (el) tabRefs.current.set(tab.id, el)
                else tabRefs.current.delete(tab.id)
              }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              className={selected ? 'tabs__tab tabs__tab--active' : 'tabs__tab'}
              onClick={() => select(index)}
            >
              {tab.title}
            </button>
          )
        })}
      </div>
      {tabs.map((tab, index) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`${baseId}-panel-${tab.id}`}
          aria-labelledby={`${baseId}-tab-${tab.id}`}
          tabIndex={0}
          hidden={index !== selectedIndex}
          className="tabs__panel"
        >
          {tab.content}
        </div>
      ))}
    </div>
  )
}
