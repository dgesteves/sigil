import { isInaccessible } from '@testing-library/dom'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { PersonPicker } from '../../src/PersonPicker.tsx'
import { axeViolations, eventually, label, settle } from './a11y.ts'

afterEach(cleanup)

const team = [
  { id: 'alice', name: 'Alice Ng' },
  { id: 'alan', name: 'Alan Cho' },
  { id: 'bea', name: 'Bea Ruiz' },
  { id: 'carlos', name: 'Carlos Alba' },
  { id: 'dana', name: 'Dana Lee' },
]
const AL = ['Alice Ng', 'Alan Cho', 'Carlos Alba']

function setup() {
  const user = userEvent.setup()
  const onAssign = vi.fn()
  const onReview = vi.fn()
  render(
    <>
      <PersonPicker label="Assignee" people={team} onSelect={onAssign} />
      <PersonPicker label="Reviewer" people={team} onSelect={onReview} />
      <button type="button">Save</button>
    </>,
  )
  return { user, onAssign, onReview }
}

const combo = (name: string) => screen.getByRole('combobox', { name }) as HTMLInputElement

/** The popup the combobox says it controls. It must exist, be a listbox, and be shown. */
function listboxOf(cb: HTMLElement) {
  const id = cb.getAttribute('aria-controls')
  expect(id, 'an expanded combobox needs aria-controls pointing at its popup').toBeTruthy()
  const popup = document.getElementById(id!)
  expect(popup, `aria-controls="${id}" must reference an element`).not.toBeNull()
  expect(popup!.getAttribute('role')).toBe('listbox')
  expect(isInaccessible(popup!)).toBe(false)
  return popup!
}

const options = (listbox: HTMLElement) => within(listbox).getAllByRole('option')

/** The highlighted option: DOM focus on an option, or the combobox's aria-activedescendant. */
function highlighted(cb: HTMLElement): HTMLElement | null {
  const active = document.activeElement as HTMLElement | null
  if (active?.getAttribute('role') === 'option') return active
  const id = cb.getAttribute('aria-activedescendant')
  return id ? document.getElementById(id) : null
}

function highlightIndex(cb: HTMLElement) {
  const listbox = listboxOf(cb)
  const opts = options(listbox)
  const h = highlighted(cb)
  if (h === null) {
    expect(opts.filter((o) => o.getAttribute('aria-selected') === 'true')).toEqual([])
    return -1
  }
  expect(listbox.contains(h), 'the highlighted option must be inside this combobox popup').toBe(true)
  expect(h.getAttribute('role')).toBe('option')
  for (const o of opts) {
    expect(o.getAttribute('aria-selected') === 'true', `aria-selected on "${label(o)}"`).toBe(o === h)
  }
  return opts.indexOf(h)
}

function expectCollapsed(cb: HTMLElement) {
  expect(cb.getAttribute('aria-expanded')).toBe('false')
  const id = cb.getAttribute('aria-controls')
  const popup = id ? document.getElementById(id) : null
  expect(popup === null || isInaccessible(popup), 'a collapsed popup must be hidden').toBe(true)
}

describe('semantics', () => {
  test('each picker input is itself a labelled, collapsed combobox with list autocomplete', () => {
    setup()
    const assignee = combo('Assignee')
    const reviewer = combo('Reviewer')
    expect(assignee).not.toBe(reviewer)
    for (const cb of [assignee, reviewer]) {
      expect(cb.tagName).toBe('INPUT')
      expectCollapsed(cb)
      expect(['list', 'both']).toContain(cb.getAttribute('aria-autocomplete'))
    }
  })

  test('typing expands a listbox of the matching people that the combobox controls', async () => {
    const { user } = setup()
    const cb = combo('Assignee')
    await user.type(cb, 'al')
    await eventually(() => {
      expect(cb.getAttribute('aria-expanded')).toBe('true')
      expect(options(listboxOf(cb)).map(label)).toEqual(AL)
    })
    expect(document.activeElement).toBe(cb)
  })

  test('no axe violations while collapsed and while a suggestion is highlighted', async () => {
    const { user } = setup()
    expect(await axeViolations()).toEqual([])
    const cb = combo('Assignee')
    await user.type(cb, 'al')
    await user.keyboard('{ArrowDown}')
    await eventually(() => expect(highlightIndex(cb)).toBeGreaterThanOrEqual(0))
    expect(await axeViolations()).toEqual([])
  })
})

describe('keyboard', () => {
  test('Down and Up Arrow move one highlighted, selected option', async () => {
    const { user } = setup()
    const cb = combo('Assignee')
    await user.type(cb, 'al')
    await eventually(() => expect(cb.getAttribute('aria-expanded')).toBe('true'))
    await settle()
    const start = highlightIndex(cb)
    await user.keyboard('{ArrowDown}')
    await eventually(() => expect(highlightIndex(cb)).toBe(start + 1))
    await user.keyboard('{ArrowDown}')
    await eventually(() => expect(highlightIndex(cb)).toBe(start + 2))
    await user.keyboard('{ArrowUp}')
    await eventually(() => expect(highlightIndex(cb)).toBe(start + 1))
  })

  test('typing while an option is highlighted keeps editing the input', async () => {
    const { user } = setup()
    const cb = combo('Assignee')
    await user.type(cb, 'a')
    await user.keyboard('{ArrowDown}')
    await eventually(() => expect(highlighted(cb)).not.toBeNull())
    await user.keyboard('l')
    await eventually(() => {
      expect(cb.value).toBe('al')
      expect(document.activeElement).toBe(cb)
      expect(options(listboxOf(cb)).map(label)).toEqual(AL)
    })
  })

  test('Enter picks the highlighted person, collapses, and keeps focus in the input', async () => {
    const { user, onAssign, onReview } = setup()
    const cb = combo('Assignee')
    await user.type(cb, 'al')
    await eventually(() => expect(cb.getAttribute('aria-expanded')).toBe('true'))
    await settle()
    const start = highlightIndex(cb)
    await user.keyboard('{ArrowDown}')
    await eventually(() => expect(highlightIndex(cb)).toBe(start + 1))
    await user.keyboard('{ArrowDown}')
    await eventually(() => expect(highlightIndex(cb)).toBe(start + 2))
    const name = label(highlighted(cb))
    expect(AL).toContain(name)
    await user.keyboard('{Enter}')
    await eventually(() => {
      expect(cb.value).toBe(name)
      expectCollapsed(cb)
      expect(document.activeElement).toBe(cb)
    })
    expect(onAssign).toHaveBeenCalledTimes(1)
    expect(onAssign).toHaveBeenCalledWith(team.find((p) => p.name === name))
    expect(onReview).not.toHaveBeenCalled()
  })

  test('Escape collapses the list without picking anyone and keeps focus in the input', async () => {
    const { user, onAssign } = setup()
    const cb = combo('Assignee')
    await user.type(cb, 'al')
    await user.keyboard('{ArrowDown}')
    await eventually(() => expect(highlighted(cb)).not.toBeNull())
    await user.keyboard('{Escape}')
    await eventually(() => {
      expectCollapsed(cb)
      expect(document.activeElement).toBe(cb)
    })
    expect(onAssign).not.toHaveBeenCalled()
    expect(['al', '']).toContain(cb.value)
  })

  test('suggestions are not Tab stops', async () => {
    const { user } = setup()
    const cb = combo('Assignee')
    await user.type(cb, 'al')
    await eventually(() => expect(cb.getAttribute('aria-expanded')).toBe('true'))
    for (const o of options(listboxOf(cb))) expect(o.tabIndex, `tabIndex of "${label(o)}"`).toBe(-1)
    await user.tab()
    await eventually(() => expect(document.activeElement).toBe(combo('Reviewer')))
  })
})

describe('several pickers on one page', () => {
  test('each combobox controls its own popup and options, and ids are unique', async () => {
    const { user, onReview } = setup()
    const reviewer = combo('Reviewer')
    await user.type(reviewer, 'da')
    await eventually(() => expect(options(listboxOf(reviewer)).map(label)).toEqual(['Dana Lee']))
    await settle()
    if (highlightIndex(reviewer) === -1) await user.keyboard('{ArrowDown}')
    await eventually(() => expect(label(highlighted(reviewer))).toBe('Dana Lee'))
    expect(highlightIndex(reviewer)).toBe(0)
    expect(combo('Assignee').getAttribute('aria-expanded')).toBe('false')
    const ids = [...document.querySelectorAll('[id]')].map((el) => el.id)
    expect(ids.filter((id, i) => ids.indexOf(id) !== i), 'duplicate ids').toEqual([])
    await user.keyboard('{Enter}')
    await eventually(() => expect(onReview).toHaveBeenCalledWith(team[4]))
  })
})
