import { isInaccessible } from '@testing-library/dom'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { Tabs } from '../../src/Tabs.tsx'
import { axeViolations, effectiveFocus, eventually, label, settle } from './a11y.ts'

afterEach(cleanup)

const items = [
  { id: 'summary', title: 'Summary', text: 'Total due: $120.00' },
  { id: 'lines', title: 'Line items', text: 'Hosting: $100.00' },
  { id: 'payments', title: 'Payments', text: 'Paid on 3 March' },
  { id: 'notes', title: 'Notes', text: 'Net 30 terms' },
].map((i) => ({ ...i, content: <p>{i.text}</p> }))
const titles = items.map((i) => i.title)

type User = ReturnType<typeof userEvent.setup>

function setup(props: { defaultSelectedId?: string } = {}) {
  const user = userEvent.setup()
  const onChange = vi.fn()
  render(
    <>
      <button type="button">Before</button>
      <Tabs label="Invoice sections" tabs={items} onChange={onChange} {...props} />
      <button type="button">After</button>
    </>,
  )
  return { user, onChange }
}

const tab = (name: string) => screen.getByRole('tab', { name })
const focusedTab = () => {
  const el = effectiveFocus()
  return el?.getAttribute('role') === 'tab' ? label(el) : null
}

async function press(user: User, key: string, expectedFocus: string) {
  await user.keyboard(key)
  await eventually(() => expect(focusedTab()).toBe(expectedFocus))
}

/** Tab from the "Before" button into the tab list. */
async function enterTabList(user: User, expectedFocus: string) {
  screen.getByRole('button', { name: 'Before' }).focus()
  await user.tab()
  await eventually(() => expect(focusedTab()).toBe(expectedFocus))
}

function expectSelected(name: string) {
  for (const t of titles) {
    const selected = tab(t).getAttribute('aria-selected') === 'true'
    expect(selected, `aria-selected on "${t}"`).toBe(t === name)
  }
  // Only the selected panel is exposed, it is named by its tab, and the tab points at it.
  expect(screen.getAllByRole('tabpanel')).toHaveLength(1)
  const panel = screen.getByRole('tabpanel', { name })
  expect(tab(name).getAttribute('aria-controls')).toBe(panel.id)
  expect(panel.textContent).toContain(items.find((i) => i.title === name)!.text)
  expect(isInaccessible(panel)).toBe(false)
}

describe('semantics', () => {
  test('a labelled tablist contains one tab per item', () => {
    setup()
    const list = screen.getByRole('tablist', { name: 'Invoice sections' })
    expect(within(list).getAllByRole('tab').map(label)).toEqual(titles)
  })

  test('the selected tab is marked and controls the one visible, labelled panel', () => {
    setup()
    expectSelected('Summary')
  })

  test('defaultSelectedId selects that tab', () => {
    setup({ defaultSelectedId: 'payments' })
    expectSelected('Payments')
  })

  test('no axe violations, before and after switching tabs', async () => {
    const { user } = setup()
    expect(await axeViolations()).toEqual([])
    await user.click(tab('Payments'))
    await eventually(() => expectSelected('Payments'))
    expect(await axeViolations()).toEqual([])
  })
})

describe('keyboard', () => {
  test('the tab list is one tab stop that lands on the selected tab', async () => {
    const { user } = setup({ defaultSelectedId: 'lines' })
    await enterTabList(user, 'Line items')
    await user.tab()
    await eventually(() =>
      expect(focusedTab(), 'Tab must leave the tab list instead of visiting the next tab').toBeNull(),
    )
  })

  test('Right and Left Arrow move focus between tabs and wrap around', async () => {
    const { user } = setup()
    await enterTabList(user, 'Summary')
    await press(user, '{ArrowRight}', 'Line items')
    await press(user, '{ArrowLeft}', 'Summary')
    await press(user, '{ArrowLeft}', 'Notes')
    await press(user, '{ArrowRight}', 'Summary')
  })

  test('Home and End move focus to the first and last tab', async () => {
    const { user } = setup()
    await enterTabList(user, 'Summary')
    await press(user, '{ArrowRight}', 'Line items')
    await press(user, '{End}', 'Notes')
    await press(user, '{Home}', 'Summary')
  })

  test('Enter or Space activates the focused tab (or it was already activated on focus)', async () => {
    const { user, onChange } = setup()
    await enterTabList(user, 'Summary')
    await press(user, '{ArrowRight}', 'Line items')
    await press(user, '{ArrowRight}', 'Payments')
    await user.keyboard('{Enter}')
    await eventually(() => expectSelected('Payments'))
    expect(onChange).toHaveBeenLastCalledWith('payments')
    await press(user, '{ArrowRight}', 'Notes')
    await user.keyboard(' ')
    await eventually(() => expectSelected('Notes'))
    expect(onChange).toHaveBeenLastCalledWith('notes')
    expect(focusedTab()).toBe('Notes')
  })

  test('tabbing out and back returns to the selected tab', async () => {
    const { user } = setup()
    await enterTabList(user, 'Summary')
    await press(user, '{ArrowRight}', 'Line items')
    await press(user, '{ArrowRight}', 'Payments')
    await user.keyboard('{Enter}')
    await eventually(() => expectSelected('Payments'))
    await user.tab()
    await eventually(() => expect(focusedTab()).toBeNull())
    screen.getByRole('button', { name: 'After' }).focus()
    await user.tab({ shift: true })
    await settle()
    // Shift+Tab from "After" may first land on a focusable panel; keep going back until a tab.
    if (focusedTab() === null) await user.tab({ shift: true })
    await eventually(() => expect(focusedTab()).toBe('Payments'))
  })
})
