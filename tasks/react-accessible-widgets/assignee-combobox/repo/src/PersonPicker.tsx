import { useState } from 'react'

export interface Person {
  id: string
  name: string
}

export interface PersonPickerProps {
  /** Visible label, e.g. "Assignee". */
  label: string
  people: Person[]
  onSelect: (person: Person) => void
  placeholder?: string
}

export function matches(people: Person[], query: string): Person[] {
  const q = query.trim().toLowerCase()
  if (q === '') return []
  return people.filter((person) => person.name.toLowerCase().includes(q))
}

export function PersonPicker({ label, people, onSelect, placeholder }: PersonPickerProps) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [hovered, setHovered] = useState<string | null>(null)
  const suggestions = matches(people, query)

  return (
    <div className="picker">
      <label htmlFor="person-picker-input" className="picker__label">
        {label}
      </label>
      <input
        id="person-picker-input"
        className="picker__input"
        type="text"
        autoComplete="off"
        placeholder={placeholder}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
          setOpen(true)
        }}
        onBlur={() => setOpen(false)}
      />
      {open && suggestions.length > 0 && (
        <div className="picker__menu">
          {suggestions.map((person) => (
            <div
              key={person.id}
              className={
                person.id === hovered ? 'picker__option picker__option--hover' : 'picker__option'
              }
              onMouseEnter={() => setHovered(person.id)}
              // mousedown, not click: the input's blur would close the menu before a click lands.
              onMouseDown={(event) => {
                event.preventDefault()
                setQuery(person.name)
                setOpen(false)
                onSelect(person)
              }}
            >
              {person.name}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
