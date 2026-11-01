# Testing Svelte 5 with Vitest and jsdom

Checked with svelte 5.57.3, @sveltejs/vite-plugin-svelte 7.3.1, vite 8.3.5, vitest 5.0.5 and
jsdom 30.1.3.

## Configuration

```ts
// vitest.config.ts: Vitest uses it instead of vite.config.ts, so the browser condition below
// never reaches production or SSR builds
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [svelte()],
  resolve: { conditions: ['browser'] },
  test: { environment: 'jsdom', include: ['src/**/*.test.ts', 'test/**/*.test.ts'] },
})
```

With a single `vite.config.ts`, the docs' variant applies the condition only under Vitest by
checking the `VITEST` environment variable that Vitest sets.

- Without the `browser` condition Vitest resolves Svelte's server build, and `mount` fails with
  `lifecycle_function_unavailable`. (`'development'` is optional; in this setup Svelte's dev checks
  were active with `['browser']` alone.)
- The plugin reads `svelte.config.js`, including a forced `runes` option.
- `@testing-library/svelte` 5.4 declares Svelte 5 support if you prefer `render`/`screen` (not
  exercised here); the plain API below needs no extra dependency.

## Mount, act, flush, assert

```ts
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'
import Rating from '../src/Rating.svelte'

let app: Record<string, unknown> | undefined
afterEach(() => {
  if (app) unmount(app)
  document.body.innerHTML = ''
})

test('clicking a star reports the value', () => {
  const onrate = vi.fn()
  const target = document.body.appendChild(document.createElement('div'))
  app = mount(Rating, { target, props: { max: 5, onrate } })
  flushSync() // onMount, $effect, bind:this

  target.querySelectorAll('button')[3]!.click()
  flushSync() // apply the state change to the DOM
  expect(onrate).toHaveBeenCalledWith(4)
  expect(target.querySelector('[aria-checked="true"]')?.textContent).toBe('4')
})
```

- Markup is rendered synchronously by `mount`. Effects, `onMount`, attachments, actions and
  `bind:this` are not: they run at the next flush (a microtask, or `flushSync()`).
- After changing state, `flushSync()` or `await tick()` before reading the DOM.
- `mount` plays intro transitions by default and jsdom has no `Element.animate`, so a component
  with `transition:`/`in:` throws `element.animate is not a function`. Pass `intro: false`, or stub
  `Element.prototype.animate` for that test.
- Dispatch synthetic events with `bubbles: true`: `onclick`, `oninput`, `onkeydown` and friends are
  delegated to the root. For `bind:value`, set `input.value` and dispatch an `input` event.

## Changing props from a test

Use runes in the test file by naming it `*.svelte.test.ts`:

```ts
// slider.svelte.test.ts
import { flushSync, mount } from 'svelte'
import { expect, test } from 'vitest'
import Slider from '../src/Slider.svelte'

test('the label follows the max prop', () => {
  const props = $state({ value: 3, max: 10 })
  const target = document.createElement('div')
  mount(Slider, { target, props })
  props.max = 20
  flushSync()
  expect(target.querySelector('output')?.textContent).toBe('3 / 20')
})
```

A plain object as `props` is read once; mutating it later does nothing.

## Bindings, snippets and context: use harness components

`bind:` and snippets are template syntax, so the cleanest test is a small `.svelte` file next to the
test:

```svelte
<!-- test/SliderHarness.svelte -->
<script lang="ts">
  import Slider from '../src/Slider.svelte'
  let value = $state(1)
</script>
<Slider bind:value max={5}>
  {#snippet label(v)}<b class="label">{v} stars</b>{/snippet}
</Slider>
<output class="parent">{value}</output>
```

Assert on `.parent` after interacting with the slider: it is the only reliable check that the prop
is `$bindable`, because without `$bindable` nothing throws and the child still updates itself.

Programmatic snippets work too:

```ts
import { createRawSnippet } from 'svelte'

const label = createRawSnippet((v: () => number) => ({
  render: () => `<b class="label">${v()} stars</b>`, // one element: extra siblings are dropped
  setup: (node) => {
    // optional: wire up behaviour; return a cleanup
  },
}))
mount(Slider, { target, props: { value: 1, label } })
```

Context: wrap the component in a function that sets it (5.50+ for `createContext` setters):

```ts
function WithQueue(...args: Parameters<typeof Player>) {
  setQueue(new Queue())
  return Player(...args)
}
mount(WithQueue, { target })
```

## Testing state modules and classes

```ts
// queue.test.ts (no component, no flush)
import { expect, test } from 'vitest'
import { Queue } from '../src/queue.svelte.ts'

test('derived values are current right away', () => {
  const q = new Queue()
  q.enqueue({ id: 'a', title: 'A', durationSec: 60 })
  expect(q.remainingSec).toBe(60)
})
```

- Creating the class in a plain test is itself a check: an `$effect` in the constructor throws
  `effect_orphan`.
- Code that intentionally creates effects needs a root in the test:
  `const cleanup = $effect.root(() => { …; flushSync(); expect(…) }); cleanup()`.
- To check a value is a plain snapshot, run it through `structuredClone`.
- Module singletons keep state between tests in the same file: reset them in `beforeEach`.

## What jsdom cannot prove

- No layout (sizes are 0) and no `ResizeObserver`: `bind:clientWidth` and the other dimension
  bindings throw `ResizeObserver is not defined` unless you stub it.
- No `Element.animate`: transitions and animations throw unless intros are off or stubbed.
- No `<dialog>.showModal()`, no Popover API.
- Hydration needs the server build of the component (`generate: 'server'`) and `render` from
  `svelte/server`, then `hydrate` with the client build; most projects test SSR with their
  framework's tooling or a browser runner instead.
