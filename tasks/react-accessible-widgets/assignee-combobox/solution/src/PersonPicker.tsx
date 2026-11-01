import { type KeyboardEvent, useId, useState } from 'react'

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

/**
 * ARIA 1.2 editable combobox with list autocomplete (WAI-ARIA APG combobox pattern). DOM focus
 * never leaves the input; aria-activedescendant names the highlighted option, which is the one
 * with aria-selected="true". Ids come from useId so several pickers can share a page.
 */
export function PersonPicker({ label, people, onSelect, placeholder }: PersonPickerProps) {
  const id = useId()
  const inputId = `${id}-input`
  const listboxId = `${id}-listbox`
  const optionId = (person: Person) => `${id}-option-${person.id}`

  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  const suggestions = matches(people, query)
  const expanded = open && suggestions.length > 0
  const active = expanded ? (suggestions.find((p) => p.id === activeId) ?? null) : null

  const collapse = () => {
    setOpen(false)
    setActiveId(null)
  }

  const pick = (person: Person) => {
    setQuery(person.name)
    collapse()
    onSelect(person)
  }

  /** Moves the highlight by one option, wrapping at both ends like the APG example. */
  const move = (step: 1 | -1) => {
    if (suggestions.length === 0) return
    setOpen(true)
    const current = active ? suggestions.indexOf(active) : -1
    const next =
      current === -1
        ? step === 1
          ? 0
          : suggestions.length - 1
        : (current + step + suggestions.length) % suggestions.length
    setActiveId(suggestions[next]!.id)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // Never steal keys from an IME composition (e.g. Enter confirming Japanese input).
    if (event.nativeEvent.isComposing) return
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        if (event.altKey) setOpen(true)
        else move(1)
        break
      case 'ArrowUp':
        event.preventDefault()
        if (event.altKey) collapse()
        else move(-1)
        break
      case 'Enter':
        if (active) {
          // Picking a suggestion must not also submit a surrounding form.
          event.preventDefault()
          pick(active)
        }
        break
      case 'Escape':
        if (expanded) {
          event.preventDefault()
          collapse()
        } else if (query !== '') {
          event.preventDefault()
          setQuery('')
        }
        break
    }
  }

  return (
    <div className="picker">
      <label htmlFor={inputId} className="picker__label">
        {label}
      </label>
      <input
        id={inputId}
        className="picker__input"
        type="text"
        role="combobox"
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={listboxId}
        aria-activedescendant={active ? optionId(active) : undefined}
        placeholder={placeholder}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
          setOpen(true)
          setActiveId(null)
        }}
        onKeyDown={onKeyDown}
        onBlur={collapse}
      />
      <ul
        id={listboxId}
        role="listbox"
        aria-label={`${label} suggestions`}
        className="picker__menu"
        hidden={!expanded}
      >
        {expanded &&
          suggestions.map((person) => (
            <li
              key={person.id}
              id={optionId(person)}
              role="option"
              aria-selected={person.id === active?.id}
              className={
                person.id === active?.id ? 'picker__option picker__option--active' : 'picker__option'
              }
              onMouseEnter={() => setActiveId(person.id)}
              // mousedown, not click: the input's blur would close the list before a click lands.
              onMouseDown={(event) => {
                event.preventDefault()
                pick(person)
              }}
            >
              {person.name}
            </li>
          ))}
      </ul>
    </div>
  )
}
