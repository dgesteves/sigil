import { isInaccessible } from '@testing-library/dom'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { MenuButton } from '../src/MenuButton.tsx'

afterEach(cleanup)

function setup() {
  const user = userEvent.setup()
  const onProfile = vi.fn()
  const onSignOut = vi.fn()
  render(
    <MenuButton
      label="Account"
      items={[
        { id: 'profile', label: 'Profile', onSelect: onProfile },
        { id: 'sign-out', label: 'Sign out', onSelect: onSignOut },
      ]}
    />,
  )
  return { user, onProfile, onSignOut }
}

const shown = (text: string) => {
  const el = screen.queryByText(text)
  return el !== null && !isInaccessible(el)
}

test('the menu is closed until the button is clicked', async () => {
  const { user } = setup()
  expect(shown('Profile')).toBe(false)
  await user.click(screen.getByText('Account'))
  expect(shown('Profile')).toBe(true)
  expect(shown('Sign out')).toBe(true)
})

test('clicking an item runs it and closes the menu', async () => {
  const { user, onProfile, onSignOut } = setup()
  await user.click(screen.getByText('Account'))
  await user.click(screen.getByText('Sign out'))
  expect(onSignOut).toHaveBeenCalledTimes(1)
  expect(onProfile).not.toHaveBeenCalled()
  expect(shown('Profile')).toBe(false)
})

test('clicking outside closes the menu', async () => {
  const { user } = setup()
  await user.click(screen.getByText('Account'))
  await user.click(document.body)
  expect(shown('Profile')).toBe(false)
})
