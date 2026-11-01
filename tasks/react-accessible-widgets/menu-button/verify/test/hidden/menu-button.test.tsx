import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { MenuButton } from '../../src/MenuButton.tsx'
import { axeViolations, effectiveFocus, eventually, label } from './a11y.ts'

afterEach(cleanup)

const labels = ['Profile', 'Settings', 'Billing', 'Sign out']

type User = ReturnType<typeof userEvent.setup>

function setup() {
  const user = userEvent.setup()
  const handlers = Object.fromEntries(labels.map((l) => [l, vi.fn()]))
  render(
    <>
      <button type="button">Before</button>
      <MenuButton
        label="Account"
        items={labels.map((l) => ({
          id: l.toLowerCase().replace(' ', '-'),
          label: l,
          onSelect: handlers[l]!,
        }))}
      />
      <button type="button">After</button>
    </>,
  )
  return { user, handlers }
}

const trigger = () => screen.getByRole('button', { name: /^Account\b/ })
const focusedItem = () => {
  const el = effectiveFocus()
  return el?.getAttribute('role') === 'menuitem' ? label(el) : null
}

async function press(user: User, key: string, expectedFocus: string) {
  await user.keyboard(key)
  await eventually(() => expect(focusedItem()).toBe(expectedFocus))
}

/** Tabs to the menu button and presses `key`, which should open the menu on the first item. */
async function openWith(user: User, key: string) {
  screen.getByRole('button', { name: 'Before' }).focus()
  await user.tab()
  expect(document.activeElement).toBe(trigger())
  await press(user, key, 'Profile')
}

function expectClosed() {
  expect(screen.queryByRole('menu')).toBeNull()
  expect(trigger().getAttribute('aria-expanded')).toBe('false')
}

function expectOpen() {
  const menu = screen.getByRole('menu')
  expect(trigger().getAttribute('aria-expanded')).toBe('true')
  return menu
}

describe('semantics', () => {
  test('the closed button announces that it opens a menu', () => {
    setup()
    expect(['menu', 'true']).toContain(trigger().getAttribute('aria-haspopup'))
    expectClosed()
  })

  test('the open menu is labelled, holds the items as menuitems, and is what aria-controls points to', async () => {
    const { user } = setup()
    await openWith(user, '{Enter}')
    const menu = expectOpen()
    expect(screen.getByRole('menu', { name: /\S/ })).toBe(menu)
    expect(within(menu).getAllByRole('menuitem').map(label)).toEqual(labels)
    const controls = trigger().getAttribute('aria-controls')
    if (controls) expect(document.getElementById(controls)).toBe(menu)
  })

  test('no axe violations while closed and while open', async () => {
    const { user } = setup()
    expect(await axeViolations()).toEqual([])
    await openWith(user, '{Enter}')
    expect(await axeViolations()).toEqual([])
  })
})

describe('keyboard', () => {
  test('Enter on the button opens the menu and focuses the first item', async () => {
    const { user } = setup()
    await openWith(user, '{Enter}')
    expectOpen()
  })

  test('Space on the button opens the menu and focuses the first item', async () => {
    const { user } = setup()
    await openWith(user, ' ')
    expectOpen()
  })

  test('Down and Up Arrow move through the items and wrap at both ends', async () => {
    const { user } = setup()
    await openWith(user, '{Enter}')
    await press(user, '{ArrowDown}', 'Settings')
    await press(user, '{ArrowDown}', 'Billing')
    await press(user, '{ArrowDown}', 'Sign out')
    await press(user, '{ArrowDown}', 'Profile')
    await press(user, '{ArrowUp}', 'Sign out')
    await press(user, '{ArrowUp}', 'Billing')
  })

  test('Home and End move to the first and last item', async () => {
    const { user } = setup()
    await openWith(user, '{Enter}')
    await press(user, '{End}', 'Sign out')
    await press(user, '{Home}', 'Profile')
  })

  test('Enter on an item runs it, closes the menu and returns focus to the button', async () => {
    const { user, handlers } = setup()
    await openWith(user, '{Enter}')
    await press(user, '{ArrowDown}', 'Settings')
    await press(user, '{ArrowDown}', 'Billing')
    await user.keyboard('{Enter}')
    await eventually(() => {
      expectClosed()
      expect(document.activeElement).toBe(trigger())
    })
    expect(handlers.Billing).toHaveBeenCalledTimes(1)
    for (const l of labels.filter((x) => x !== 'Billing')) expect(handlers[l]).not.toHaveBeenCalled()
  })

  test('Escape closes the menu without running anything and returns focus to the button', async () => {
    const { user, handlers } = setup()
    await openWith(user, '{Enter}')
    await press(user, '{ArrowDown}', 'Settings')
    await user.keyboard('{Escape}')
    await eventually(() => {
      expectClosed()
      expect(document.activeElement).toBe(trigger())
    })
    for (const l of labels) expect(handlers[l]).not.toHaveBeenCalled()
    // Reopening starts from the first item again.
    await press(user, '{Enter}', 'Profile')
  })

  test('menu items are not Tab stops, and Tab closes the menu', async () => {
    const { user, handlers } = setup()
    await openWith(user, '{Enter}')
    for (const item of within(screen.getByRole('menu')).getAllByRole('menuitem')) {
      expect(item.tabIndex, `tabIndex of "${label(item)}"`).toBe(-1)
    }
    await user.tab()
    await eventually(() => {
      expectClosed()
      expect(focusedItem()).toBeNull()
    })
    for (const l of labels) expect(handlers[l]).not.toHaveBeenCalled()
  })
})
