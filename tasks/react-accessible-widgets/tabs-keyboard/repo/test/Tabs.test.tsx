import { isInaccessible } from '@testing-library/dom'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { Tabs } from '../src/Tabs.tsx'

afterEach(cleanup)

const tabs = [
  { id: 'summary', title: 'Summary', content: <p>Total due: $120.00</p> },
  { id: 'lines', title: 'Line items', content: <p>Hosting: $100.00</p> },
  { id: 'payments', title: 'Payments', content: <p>No payments yet</p> },
]

const shown = (text: string) => {
  const el = screen.queryByText(text)
  return el !== null && !isInaccessible(el)
}

test('shows the first tab by default', () => {
  render(<Tabs label="Invoice sections" tabs={tabs} />)
  expect(shown('Total due: $120.00')).toBe(true)
  expect(shown('No payments yet')).toBe(false)
})

test('respects defaultSelectedId', () => {
  render(<Tabs label="Invoice sections" tabs={tabs} defaultSelectedId="payments" />)
  expect(shown('No payments yet')).toBe(true)
  expect(shown('Total due: $120.00')).toBe(false)
})

test('clicking a tab shows its content and reports the change', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  render(<Tabs label="Invoice sections" tabs={tabs} onChange={onChange} />)
  await user.click(screen.getByText('Line items'))
  expect(shown('Hosting: $100.00')).toBe(true)
  expect(shown('Total due: $120.00')).toBe(false)
  expect(onChange).toHaveBeenLastCalledWith('lines')
})
