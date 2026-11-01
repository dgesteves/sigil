import { isInaccessible } from '@testing-library/dom'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { matches, PersonPicker } from '../src/PersonPicker.tsx'

afterEach(cleanup)

const team = [
  { id: 'alice', name: 'Alice Ng' },
  { id: 'alan', name: 'Alan Cho' },
  { id: 'bea', name: 'Bea Ruiz' },
]

const shown = (text: string) => {
  const el = screen.queryByText(text)
  return el !== null && !isInaccessible(el)
}

test('matches() filters by a case-insensitive substring', () => {
  expect(matches(team, 'AL').map((p) => p.id)).toEqual(['alice', 'alan'])
  expect(matches(team, '  ')).toEqual([])
})

test('typing shows matching people and clicking one selects them', async () => {
  const user = userEvent.setup()
  const onSelect = vi.fn()
  render(<PersonPicker label="Assignee" people={team} onSelect={onSelect} />)
  const input = screen.getByLabelText('Assignee')
  await user.type(input, 'al')
  expect(shown('Alice Ng')).toBe(true)
  expect(shown('Alan Cho')).toBe(true)
  expect(shown('Bea Ruiz')).toBe(false)
  await user.click(screen.getByText('Alan Cho'))
  expect(onSelect).toHaveBeenCalledWith(team[1])
  expect((input as HTMLInputElement).value).toBe('Alan Cho')
  expect(shown('Alice Ng')).toBe(false)
})
