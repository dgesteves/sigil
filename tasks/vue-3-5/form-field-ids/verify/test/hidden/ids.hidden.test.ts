import { afterEach, describe, expect, test, vi } from 'vitest'
import { type App, createApp, nextTick } from 'vue'
import AccountSettings from '../../src/AccountSettings.vue'
import { hydratePage } from '../../src/entry-client.ts'
import { renderPage } from '../../src/entry-server.ts'

let apps: App[] = []
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

/** Every id on the page is unique and every for / aria-describedby / radio name resolves correctly. */
function expectWired(root: ParentNode) {
  const ids = [...root.querySelectorAll('[id]')].map((el) => el.id)
  const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i)
  expect(duplicates, 'duplicate ids on the page').toEqual([])
  expect(ids.every((id) => id.length > 0)).toBe(true)

  const labels = [...root.querySelectorAll('label')]
  expect(labels.length).toBeGreaterThan(0)
  for (const label of labels) {
    const target = label.htmlFor ? document.getElementById(label.htmlFor) : null
    expect(target, `label "${label.textContent}" points at nothing`).not.toBeNull()
    expect(target!.tagName).toBe('INPUT')
    const container = label.closest('.field, .radio-group__option')
    expect(container, `label "${label.textContent}" is outside its field`).not.toBeNull()
    expect(container!.contains(target), `label "${label.textContent}" points into another field`).toBe(true)
  }

  for (const input of root.querySelectorAll('[aria-describedby]')) {
    const field = input.closest('.field')!
    for (const ref of input.getAttribute('aria-describedby')!.split(/\s+/)) {
      const target = document.getElementById(ref)
      expect(target, `aria-describedby "${ref}" points at nothing`).not.toBeNull()
      expect(field.contains(target), `aria-describedby "${ref}" points into another field`).toBe(true)
    }
  }

  const groups = [...root.querySelectorAll('fieldset.radio-group')]
  const names = groups.map((group) => {
    const radioNames = [...group.querySelectorAll<HTMLInputElement>('input[type="radio"]')].map((r) => r.name)
    expect(radioNames.length).toBeGreaterThan(1)
    expect(new Set(radioNames).size, 'radios of one group must share a name').toBe(1)
    expect(radioNames[0]).not.toBe('')
    return radioNames[0]
  })
  expect(new Set(names).size, 'radio groups on the page must have different names').toBe(names.length)
}

function captureHydrationMessages() {
  const messages: string[] = []
  const record = (...args: unknown[]) => {
    messages.push(args.map(String).join(' '))
  }
  vi.spyOn(console, 'warn').mockImplementation(record)
  vi.spyOn(console, 'error').mockImplementation(record)
  return () => messages.filter((m) => /hydrat|mismatch/i.test(m))
}

describe('server rendering', () => {
  test('renders the same markup on every request', async () => {
    const first = await renderPage()
    const second = await renderPage()
    const third = await renderPage()
    expect(second).toBe(first)
    expect(third).toBe(first)
  })

  test('renders the same markup for concurrent requests', async () => {
    const sequential = await renderPage()
    const concurrent = await Promise.all([renderPage(), renderPage(), renderPage()])
    expect(concurrent).toEqual([sequential, sequential, sequential])
  })

  test('the rendered page has unique, correctly wired ids', async () => {
    document.body.innerHTML = await renderPage()
    expect(document.querySelectorAll('#search .field').length).toBeGreaterThan(1)
    expect(document.querySelectorAll('#account .field').length).toBeGreaterThan(3)
    expectWired(document)
  })
})

describe('hydration', () => {
  test('hydrates without mismatches, also after the server has served other requests', async () => {
    await renderPage()
    await renderPage()
    document.body.innerHTML = await renderPage()
    const hydrationMessages = captureHydrationMessages()
    apps = hydratePage(document)
    await nextTick()
    expect(hydrationMessages()).toEqual([])
    expectWired(document)
  })

  test('the hydrated page works: labels still activate their inputs', async () => {
    document.body.innerHTML = await renderPage()
    apps = hydratePage(document)
    await nextTick()
    const free = [...document.querySelectorAll('label')].find((l) => l.textContent === 'Free')!
    free.click()
    expect((document.getElementById(free.htmlFor) as HTMLInputElement).checked).toBe(true)
    const inStock = [...document.querySelectorAll('label')].find((l) => l.textContent === 'Only in stock')!
    inStock.click()
    expect((document.getElementById(inStock.htmlFor) as HTMLInputElement).checked).toBe(true)
  })
})

describe('client-only rendering', () => {
  test('fields mounted without SSR are wired up too', async () => {
    const el = document.createElement('div')
    document.body.append(el)
    const app = createApp(AccountSettings)
    app.mount(el)
    apps.push(app)
    expectWired(document)
  })
})
