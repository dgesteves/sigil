import userEvent from '@testing-library/user-event'
import { type VueWrapper, mount } from '@vue/test-utils'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { nextTick } from 'vue'
import ArticleForm from '../../src/components/ArticleForm.vue'
import SearchFilters from '../../src/components/SearchFilters.vue'
import { createDraftStore } from '../../src/draftStore.ts'
import ExternalReset from './ExternalReset.vue'

const mounted: VueWrapper[] = []
afterEach(() => {
  for (const w of mounted.splice(0)) w.unmount()
  document.body.innerHTML = ''
})

function mountAttached<T>(component: T, options: Record<string, unknown> = {}) {
  // biome-ignore lint/suspicious/noExplicitAny: test helper
  const wrapper = mount(component as any, { ...options, attachTo: document.body })
  mounted.push(wrapper)
  return wrapper
}

const labels = (root: VueWrapper | ReturnType<VueWrapper['find']>) =>
  root.findAll('.tag-input__label').map((el) => el.text())

function articleForm(tags: string[] = ['vue'], keywords: string[] = ['seo']) {
  const store = createDraftStore({ title: 'Release notes', tags, keywords })
  const wrapper = mountAttached(ArticleForm, { props: { store } })
  const [tagsBox, keywordsBox] = wrapper.findAll('.tag-input')
  return {
    store,
    wrapper,
    tagsBox: tagsBox!,
    keywordsBox: keywordsBox!,
    tagsField: tagsBox!.find('input.tag-input__field').element as HTMLInputElement,
    keywordsField: keywordsBox!.find('input.tag-input__field').element as HTMLInputElement,
  }
}

describe('with v-model (ArticleForm and the frozen draft store)', () => {
  test('Enter adds a tag to the bound value without touching the array it was given', async () => {
    const user = userEvent.setup()
    const { store, tagsBox, tagsField } = articleForm()
    const before = store.draft.value.tags
    await user.type(tagsField, 'nuxt{Enter}')
    expect(store.draft.value.tags).toEqual(['vue', 'nuxt'])
    expect(before).toEqual(['vue'])
    expect(labels(tagsBox)).toEqual(['vue', 'nuxt'])
    expect(tagsField.value).toBe('')
  })

  test('a comma adds the tag typed before it', async () => {
    const user = userEvent.setup()
    const { store, tagsField } = articleForm()
    await user.type(tagsField, 'vite,pinia,')
    expect(store.draft.value.tags).toEqual(['vue', 'vite', 'pinia'])
    expect(tagsField.value).toBe('')
  })

  test('tags are trimmed, blanks and case-insensitive duplicates are ignored', async () => {
    const user = userEvent.setup()
    const { store, tagsField } = articleForm(['vue', 'Vite'])
    await user.type(tagsField, '  router  {Enter}')
    await user.type(tagsField, '   {Enter}')
    await user.type(tagsField, 'VUE{Enter}')
    await user.type(tagsField, 'vite{Enter}')
    expect(store.draft.value.tags).toEqual(['vue', 'Vite', 'router'])
  })

  test('Backspace in an empty field removes the last tag, but not while text is typed', async () => {
    const user = userEvent.setup()
    const { store, tagsField } = articleForm(['vue', 'vite', 'pinia'])
    await user.type(tagsField, 'ab{Backspace}{Backspace}')
    expect(store.draft.value.tags).toEqual(['vue', 'vite', 'pinia'])
    await user.type(tagsField, '{Backspace}')
    expect(store.draft.value.tags).toEqual(['vue', 'vite'])
  })

  test('the remove button removes that tag', async () => {
    const user = userEvent.setup()
    const { store, tagsBox } = articleForm(['vue', 'vite', 'pinia'])
    await user.click(tagsBox.find('button[aria-label="Remove vite"]').element)
    expect(store.draft.value.tags).toEqual(['vue', 'pinia'])
    expect(labels(tagsBox)).toEqual(['vue', 'pinia'])
  })

  test('v-model.lowercase lowercases new tags; plain v-model keeps their case', async () => {
    const user = userEvent.setup()
    const { store, tagsField, keywordsField, keywordsBox } = articleForm(['vue'], ['seo'])
    await user.type(keywordsField, 'TypeScript{Enter}')
    await user.type(keywordsField, 'SEO{Enter}')
    await user.type(tagsField, 'TypeScript{Enter}')
    expect(store.draft.value.keywords).toEqual(['seo', 'typescript'])
    expect(labels(keywordsBox)).toEqual(['seo', 'typescript'])
    expect(store.draft.value.tags).toEqual(['vue', 'TypeScript'])
  })

  test('shows changes the parent makes to the bound value', async () => {
    const { store, tagsBox } = articleForm(['vue'])
    store.update({ tags: ['breaking', 'politics'] })
    await nextTick()
    expect(labels(tagsBox)).toEqual(['breaking', 'politics'])

    const wrapper = mountAttached(ExternalReset)
    expect(labels(wrapper)).toEqual(['draft'])
    ;(wrapper.vm as unknown as { replace: (t: string[]) => void }).replace([])
    await nextTick()
    expect(labels(wrapper)).toEqual([])
  })
})

describe('without v-model (SearchFilters)', () => {
  test('keeps its own list, starting empty, and reports every change', async () => {
    const user = userEvent.setup()
    const wrapper = mountAttached(SearchFilters)
    const field = wrapper.find('input.tag-input__field').element as HTMLInputElement
    expect(labels(wrapper)).toEqual([])

    await user.type(field, 'climate{Enter}')
    await user.type(field, 'energy,')
    expect(labels(wrapper)).toEqual(['climate', 'energy'])

    await user.type(field, '{Backspace}')
    expect(labels(wrapper)).toEqual(['climate'])

    const changes = (wrapper.emitted('change') ?? []).map(([payload]) => (payload as { tags: string[] }).tags)
    expect(changes).toEqual([['climate'], ['climate', 'energy'], ['climate']])
  })

  test('instances do not share state', async () => {
    const user = userEvent.setup()
    const first = mountAttached(SearchFilters)
    await user.type(first.find('input.tag-input__field').element, 'local{Enter}')
    const second = mountAttached(SearchFilters)
    expect(labels(first)).toEqual(['local'])
    expect(labels(second)).toEqual([])
    await user.click(first.find('button[aria-label="Remove local"]').element)
    expect(labels(first)).toEqual([])
    const third = mountAttached(SearchFilters)
    expect(labels(third)).toEqual([])
  })
})

describe('console', () => {
  test('no Vue warnings while editing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const user = userEvent.setup()
    const { tagsField } = articleForm()
    await user.type(tagsField, 'nuxt{Enter}{Backspace}')
    const filters = mountAttached(SearchFilters)
    await user.type(filters.find('input.tag-input__field').element, 'one{Enter}')
    const vueWarnings = warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('[Vue warn]'))
    warn.mockRestore()
    expect(vueWarnings).toEqual([])
  })
})
