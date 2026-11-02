# Testing with Vitest, @vue/test-utils and SSR hydration

Checked with vitest 5.0.5, @vitejs/plugin-vue 6.0.10, @vue/test-utils 2.5.1, jsdom 30.1.3 and
vue 3.5.44.

## Setup

```ts
// vitest.config.ts
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [vue()],
  test: { environment: 'jsdom', include: ['test/**/*.test.ts'] },
})
```

TypeScript needs a shim for `.vue` imports unless vue-tsc drives the type check:

```ts
// env.d.ts
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent
  export default component
}
```

Vitest runs the development build of Vue, so warnings (`[Vue warn]`) and hydration mismatch details
are available to assert on.

## Components

```ts
import { flushPromises, mount } from '@vue/test-utils'

const wrapper = mount(ColorSwatch, {
  props: { color: 'teal' },
  slots: { default: 'Teal' },
  attrs: { class: 'large' },
  global: { provide: { [ThemeKey as symbol]: ref('dark') }, stubs: { RouterLink: true } },
  attachTo: document.body, // needed for focus, label clicks and user-event
})
await wrapper.setProps({ color: 'navy' })
await wrapper.get('button').trigger('click')
expect(wrapper.emitted('pick')).toEqual([['navy']])
await flushPromises() // resolve pending promises (fetches, async setup)
wrapper.unmount()
```

- `wrapper.vm` reaches `<script setup>` internals even without `defineExpose`. A parent component
  cannot. Test exposure through a parent template ref if it matters.
- For realistic typing (key sequences, Enter, comma, Backspace), `@testing-library/user-event`
  works on `wrapper.element`s attached to the document:
  `await userEvent.setup().type(input.element, 'teal{Enter}')`.

## v-model

```ts
// Controlled: the parent updates the prop, like v-model does.
const wrapper = mount(ChipEditor, {
  props: {
    modelValue: Object.freeze(['a']), // frozen: catches in-place mutation
    'onUpdate:modelValue': (v: string[]) => wrapper.setProps({ modelValue: v }),
  },
})

// Uncontrolled: only a listener, no prop. defineModel keeps a local value here.
const onUpdate = vi.fn()
const local = mount(ChipEditor, { props: { 'onUpdate:modelValue': onUpdate } })
```

Modifiers are props too: `modelModifiers: { uppercase: true }` (or `titleModifiers` for
`v-model:title`). A small parent SFC in the test folder that uses `v-model.uppercase` is often
clearer than wiring the props by hand.

## Composables

```ts
import { effectScope, nextTick, ref } from 'vue'

test('refetches when the city changes and cleans up', async () => {
  vi.useFakeTimers()
  const city = ref('Lisbon')
  const scope = effectScope()
  const { data } = scope.run(() => useForecast(city, { refreshMs: 1000 }))!
  await nextTick()                         // watcher callbacks run on the next microtask
  city.value = 'Porto'
  await nextTick()
  await vi.advanceTimersByTimeAsync(1000)  // runs timers and the promise callbacks between them
  scope.stop()                             // runs watcher cleanup and onScopeDispose
  vi.useRealTimers()
})
```

- A composable that uses lifecycle hooks or `inject` needs a component: mount a tiny host
  `defineComponent({ setup() { result = useThing(); return () => null } })`.
- Mock modules with `vi.mock('../src/api.ts', () => ({ getForecast: vi.fn() }))`; the path is
  resolved, so every importer of that file gets the mock.
- Controlled promises (a deferred per call) make race conditions testable: resolve the older
  request after the newer one and assert the state still shows the newer result.

## SSR and hydration

```ts
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'

test('hydrates without mismatches', async () => {
  const html = await renderToString(createSSRApp(Page)) // render more than once to catch counters
  const root = document.createElement('div')
  root.innerHTML = html
  document.body.append(root)

  const warnings: string[] = []
  const app = createSSRApp(Page)
  app.config.warnHandler = (msg) => warnings.push(msg)
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  app.mount(root) // mounting a createSSRApp app on server markup hydrates it
  expect(warnings.filter((w) => w.includes('Hydration'))).toEqual([])
  expect(errors).not.toHaveBeenCalled() // "Hydration completed but contains mismatches."
})
```

- If the code under test creates its own apps (a client entry that calls `createSSRApp` itself),
  it cannot take your `warnHandler`; spy on `console.warn` and `console.error` instead, which is
  where Vue's dev warnings go when no handler is set.
- Render the same page several times, and with `Promise.all` for concurrent requests, then compare
  the strings: per-process counters and render-reset counters show up there.
- `vue/server-renderer` re-exports `@vue/server-renderer`, which `vue` already depends on.

## Type checking

`vue-tsc --noEmit` (3.3.14, run here with TypeScript 6.0.3) type-checks `.vue` files. It catches wrong
`defineModel`/`defineEmits` payloads and missing props, but not the silent reactivity bugs in this
skill: a destructured prop passed as a value type-checks fine.
