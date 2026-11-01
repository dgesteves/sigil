import { type ReactNode, useState } from 'react'

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

export function Tabs({ label, tabs, defaultSelectedId, onChange }: TabsProps) {
  const [selectedId, setSelectedId] = useState(defaultSelectedId ?? tabs[0]?.id)
  const selected = tabs.find((tab) => tab.id === selectedId) ?? tabs[0]

  return (
    <div className="tabs" data-label={label}>
      <div className="tabs__list">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={tab.id === selected?.id ? 'tabs__tab tabs__tab--active' : 'tabs__tab'}
            onClick={() => {
              setSelectedId(tab.id)
              onChange?.(tab.id)
            }}
          >
            {tab.title}
          </div>
        ))}
      </div>
      <div className="tabs__panel">{selected?.content}</div>
    </div>
  )
}
