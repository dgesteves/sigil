import { afterEach, expect, test, vi } from 'vitest'
import IssueForm from '../../src/lib/IssueForm.svelte'
import { addTag, chips, cleanup, click, plain, render, typeInto } from './helpers.ts'

afterEach(cleanup)

const summary = (root: Element) => root.querySelector('.summary')?.textContent?.trim()
const alertText = (root: Element) => root.querySelector('[role="alert"]')?.textContent?.trim() ?? null
const chipColour = (root: Element, label: string) =>
  [...root.querySelectorAll<HTMLElement>('.chips .chip')].find((c) => c.textContent?.includes(label))
    ?.style.background

test('labels typed into the form update the summary and get their colour', () => {
  const root = render(IssueForm, { onsave: vi.fn() })
  const labels = root.querySelector('input[aria-label="Labels"]')!
  expect(chips(root)).toEqual(['triage'])
  expect(chipColour(root, 'triage')).toBe('goldenrod')
  expect(summary(root)).toBe('1 label')

  addTag(labels, 'Bug')
  expect(chips(root)).toEqual(['triage', 'bug'])
  expect(chipColour(root, 'bug')).toBe('crimson')
  expect(summary(root)).toBe('2 labels')
})

test('rejections show an alert that clears on the next change', () => {
  const root = render(IssueForm, { onsave: vi.fn(), initial: { labels: ['bug'] } })
  const labels = root.querySelector('input[aria-label="Labels"]')!
  addTag(labels, 'bug')
  expect(alertText(root)).toBe('“bug” was not added')

  addTag(labels, 'feature')
  expect(alertText(root)).toBeNull()
  addTag(labels, 'a')
  addTag(labels, 'b')
  addTag(labels, 'c')
  expect(alertText(root)).toBe('“c” was not added')
  expect(summary(root)).toBe('4 labels')
})

test('the custom chip remove button and submit use the current labels', () => {
  const onsave = vi.fn()
  const root = render(IssueForm, { onsave, initial: { title: 'Crash', labels: ['triage', 'bug'] } })
  typeInto(root.querySelector('label input')!, ' Crash on save ')
  click(root.querySelector('button[aria-label="Remove triage"]'))
  expect(summary(root)).toBe('1 label')

  click(root.querySelector('button[type="submit"]'))
  expect(onsave).toHaveBeenCalledTimes(1)
  expect(plain(onsave.mock.calls[0]![0])).toEqual({ title: 'Crash on save', labels: ['bug'] })
})
