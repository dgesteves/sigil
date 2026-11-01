# Combobox (autocomplete) with a listbox popup

ARIA 1.2 (the current W3C Recommendation) and the APG combobox pattern. The ARIA 1.3 working draft
relaxes `aria-controls` from required to supported; keep setting it, because the Recommendation,
the APG and axe-core (`aria-required-attr` on an expanded combobox) still expect it.

## Which combobox

- **Editable with list autocomplete** (the common "search users" field): typing filters the
  suggestions, the typed text stays the value until the user picks one. `aria-autocomplete="list"`.
- **List with automatic selection**: same, but the first suggestion is highlighted as soon as the
  list appears, and becomes the value on blur or Enter. Still `aria-autocomplete="list"`.
- **Inline autocomplete**: the rest of the highlighted suggestion appears selected inside the input.
  `aria-autocomplete="both"`.
- **Select-only** (no typing): consider a native `<select>` first. If you must build it, the
  combobox is a focusable element (e.g. `div tabIndex={0}`) showing the value; printable keys jump to
  matching options.
- **Suggestions that never change with input** (recent searches): `aria-autocomplete="none"`.

## Contract

Input:

- `role="combobox"` on the `<input type="text">` itself, labelled by a real `<label htmlFor>`.
  Not on a wrapper. Not `aria-owns`: those were the ARIA 1.0 and 1.1 shapes and no longer conform.
- `aria-expanded` is `"true"` while the popup is shown, `"false"` otherwise (always present).
- `aria-controls` names the listbox (set it at least while expanded).
- `aria-autocomplete` corresponds to the behaviour (see above).
- `aria-activedescendant` names the highlighted option while there is one; remove it otherwise. Never
  point it at an option that isn't mounted.
- DOM focus stays on the input the whole time: typing, caret movement, IME composition and
  Backspace keep working while an option is highlighted.

Popup:

- `role="listbox"` with `role="option"` children; give it a name (`aria-labelledby` the label or
  `aria-label`).
- Exactly the highlighted option has `aria-selected="true"`; selection follows the highlight.
- Options and any open button are not Tab stops.

Keys (input focused):

| Key | Must | Optional |
| --- | --- | --- |
| Down Arrow | popup shown: highlight the first option (or the one after the auto-selected one) | open the popup when closed |
| Up Arrow | | highlight the last option |
| Down/Up while an option is highlighted | next/previous option | wrap, or move back to the input at the ends |
| Enter | with a highlighted option: put its text in the input, close, keep the caret at the end, don't submit the form | |
| Escape | close the popup | a second Escape clears the input |
| Printable keys, Backspace, Left/Right, Home/End | edit the text as usual | |
| Alt+Down / Alt+Up | | open without highlighting / close |

Also: close on blur, and keep mouse and keyboard on one state (hover moves the highlight, click
picks).

## Reference implementation

```tsx
import { type KeyboardEvent, useId, useState } from 'react'

interface AutocompleteProps<T> {
  fieldLabel: string
  candidates: T[]
  getKey: (item: T) => string
  getLabel: (item: T) => string
  /** Return the suggestions to show for the current text. */
  filter: (items: T[], text: string) => T[]
  onPick: (item: T) => void
}

export function Autocomplete<T>(props: AutocompleteProps<T>) {
  const { fieldLabel, candidates, getKey, getLabel, filter, onPick } = props
  const id = useId()
  const fieldId = `${id}-field`
  const popupId = `${id}-suggestions`
  const suggestionId = (item: T) => `${id}-suggestion-${getKey(item)}`

  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const [activeKey, setActiveKey] = useState<string | null>(null)

  const visible = filter(candidates, text)
  const expanded = open && visible.length > 0
  // Derived, so the highlight can never point at an option that is no longer rendered.
  const active = expanded ? (visible.find((s) => getKey(s) === activeKey) ?? null) : null

  const close = () => {
    setOpen(false)
    setActiveKey(null)
  }
  const accept = (item: T) => {
    setText(getLabel(item))
    close()
    onPick(item)
  }
  const advance = (delta: 1 | -1) => {
    if (visible.length === 0) return
    setOpen(true)
    const at = active ? visible.indexOf(active) : -1
    const next =
      at === -1
        ? delta === 1
          ? 0
          : visible.length - 1
        : (at + delta + visible.length) % visible.length
    setActiveKey(getKey(visible[next]!))
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault() // keep the caret where it is
      if (event.altKey) return event.key === 'ArrowDown' ? setOpen(true) : close()
      advance(event.key === 'ArrowDown' ? 1 : -1)
    } else if (event.key === 'Enter' && active) {
      event.preventDefault() // don't submit the surrounding form
      accept(active)
    } else if (event.key === 'Escape') {
      if (expanded) close()
      else setText('')
    }
  }

  return (
    <div className="autocomplete">
      <label htmlFor={fieldId}>{fieldLabel}</label>
      <input
        id={fieldId}
        type="text"
        role="combobox"
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={popupId}
        aria-activedescendant={active ? suggestionId(active) : undefined}
        value={text}
        onChange={(event) => {
          setText(event.target.value)
          setOpen(true)
          setActiveKey(null)
        }}
        onKeyDown={onKeyDown}
        onBlur={close}
      />
      <ul id={popupId} role="listbox" aria-label={`${fieldLabel} options`} hidden={!expanded}>
        {expanded &&
          visible.map((item) => {
            const selected = item === active
            return (
              <li
                key={getKey(item)}
                id={suggestionId(item)}
                role="option"
                aria-selected={selected}
                data-active={selected}
                onPointerEnter={() => setActiveKey(getKey(item))}
                // Keep focus in the input: without this, mousedown blurs it and closes the list
                // before the click lands.
                onMouseDown={(event) => {
                  event.preventDefault()
                  accept(item)
                }}
              >
                {getLabel(item)}
              </li>
            )
          })}
      </ul>
    </div>
  )
}
```

Why it is shaped like this:

- The listbox element is always mounted (hidden when collapsed), so `aria-controls` always resolves.
  Unmounting it is fine too if you set `aria-controls` only while expanded.
- `active` is derived from the current suggestions. Storing an index instead breaks as soon as the
  list re-filters.
- Ids include the item key, not the index, so the active option keeps its id across re-filtering,
  and `useId()` keeps two autocompletes on one page from sharing ids.
- The listbox gets its own name. `aria-labelledby` pointing at the field's `<label>` is also valid
  (the ARIA spec's example does it), but then `getByLabelText(fieldLabel)` matches two elements.
- `aria-selected={selected}` renders `"false"` on the others, which is valid and explicit.
- Style the highlight from `[data-active="true"]` or `[aria-selected="true"]`; the option never has
  DOM focus, so `:focus` can't style it.
- If the list can scroll, scroll the active option into view in an effect:
  `document.getElementById(suggestionId(active))?.scrollIntoView({ block: 'nearest' })`.

## Pitfalls

- Moving DOM focus into the options (`option.focus()`). ARIA 1.2 tolerates it, but then every
  printable key, Backspace and the arrows must be forwarded back to the input, and IME composition
  breaks. The APG pattern for listbox popups keeps DOM focus on the combobox.
- Showing the highlight only with a CSS class: screen readers announce nothing on Down Arrow.
- `aria-expanded` missing while collapsed, or toggled by a different state than the one that
  renders the popup.
- Enter inside a `<form>` submitting the form instead of picking the option.
- Options rendered as `<button>`s: each becomes a Tab stop.
- Hard-coded ids such as `id="users-listbox"`: the second instance's `aria-controls` and
  `aria-activedescendant` point into the first instance's popup.
- Announcing result counts: optional. If you add a live region ("3 results"), render it once
  and update its text; don't mount a new live region per change.
- Reaching for `<datalist>`: fine for simple suggestions, but its popup is browser-styled and you
  can't control filtering or option content.
