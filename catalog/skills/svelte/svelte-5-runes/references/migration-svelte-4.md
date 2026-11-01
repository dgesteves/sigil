# Svelte 4 to Svelte 5: migration details

Checked against svelte 5.57.3. Error and warning codes are the ones the 5.57.3 compiler and runtime
emit; each message ends with a link to its explanation on the Svelte site.

## What the compiler tells you in runes mode

| Construct | Runes mode result |
| --- | --- |
| `export let x` | error `legacy_export_invalid` |
| `$: y = x * 2` | error `legacy_reactive_statement_invalid` |
| `$$props`, `$$restProps` | errors `legacy_props_invalid`, `legacy_rest_props_invalid` |
| `beforeUpdate`, `afterUpdate` imports | error `runes_mode_invalid_import` |
| `on:click` and `onclick` in one component | error `mixed_event_handler_syntaxes` |
| `on:click` alone (also with modifiers) | warning `event_directive_deprecated` |
| `<slot>` | warning `slot_element_deprecated`; error if mixed with `{@render}` |
| `<svelte:component this={C}>` | warning `svelte_component_deprecated` |
| `<svelte:self>` outside a block | error `svelte_self_invalid_placement` |
| `createEventDispatcher` | no warning (deprecated in the types only) |
| `let local = $state(prop)`, `const d = prop * 2` | warning `state_referenced_locally` |
| `$state` in a plain `.ts`/`.js` file | runtime `rune_outside_svelte` |
| `export let n = $state(0)` + reassignment | error `state_invalid_export` |
| `export const d = $derived(…)` | error `derived_invalid_export` |
| `$store` in a `.svelte.ts` module | error `store_invalid_subscription_module` |
| `new Component({ target })` | runtime `component_api_invalid_new` (compile warning `legacy_component_creation`) |
| `instance.$set/$on/$destroy` on a mounted component | runtime `component_api_changed` |
| `$effect` outside a component or root | runtime `effect_orphan` |

Silent changes (no error, no warning) are the ones to look for by hand:

- a parent `bind:x` on a prop that is not `$bindable` (the parent never updates; 5.57.3 has a
  `bind_not_bindable` error message defined but never raises it);
- callback props passed to a component that still dispatches events;
- `$state(new Set() | new Map() | new Date() | classInstance)` mutated in place;
- values copied out of state (destructuring, function arguments, plain `const` from props);
- `$derived(() => expr)`, which stores the function;
- proxies handed to `structuredClone`/`postMessage`;
- code that expects `onMount`, `$effect` or `bind:this` to have run right after `mount()`.

## Before and after

### Props, defaults, rest and renamed props

```svelte
<!-- Svelte 4 -->
<script>
  export let size = 'md'
  export let disabled = false
  let klass = ''
  export { klass as class }
</script>
<button class="btn {klass} {size}" {disabled} {...$$restProps}><slot /></button>
```

```svelte
<!-- Svelte 5 -->
<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLButtonAttributes } from 'svelte/elements'

  let {
    size = 'md',
    disabled = false,
    class: klass = '',
    children,
    ...rest
  }: HTMLButtonAttributes & { size?: 'sm' | 'md'; children?: Snippet } = $props()
</script>
<button class={['btn', klass, size]} {disabled} {...rest}>{@render children?.()}</button>
```

Fallbacks apply every time the parent passes `undefined`, not only at creation.

### Bindable props

```svelte
<!-- Svelte 4: every prop was bindable -->
<script>export let checked = false</script>
<input type="checkbox" bind:checked />

<!-- Svelte 5: opt in -->
<script>let { checked = $bindable(false) } = $props()</script>
<input type="checkbox" bind:checked />
```

Search every caller for `bind:<prop>` before deciding which props need `$bindable`. Binding to a
component export (`<A bind:foo>` where `foo` is `export const`) is an error in runes mode: use
`bind:this={a}` and read `a.foo`.

### Reactive statements

| Svelte 4 | Svelte 5 |
| --- | --- |
| `$: full = n >= max` | `const full = $derived(n >= max)` |
| `$: ({ a, b } = split(value))` | `const { a, b } = $derived(split(value))` |
| `$: if (open) dialog.showModal()` | `$effect(() => { if (open) dialog.showModal() })` or an attachment |
| `$: document.title = title` | `$effect(() => { document.title = title })` |
| `$: console.log(value)` | `$inspect(value)` |
| `$: fetchUser(id)` with a stale-response guard | `$effect` with `getAbortSignal()` or an `AbortController` torn down in the effect |

`sv migrate svelte-5` turns statements it cannot classify into `run()` from `svelte/legacy`. `run`
behaves like `$effect.pre` on the client and also runs once on the server. Replace each one with
`$derived` or `$effect`.

`$:` ran once per tick, before render, with dependencies found by static analysis. `$derived` is
pull-based: it recomputes when read after a dependency changed, so you never see a stale value.
`$effect` dependencies are whatever it read synchronously on its last run.

### Events

```svelte
<!-- Svelte 4 -->
<script>
  import { createEventDispatcher } from 'svelte'
  const dispatch = createEventDispatcher()
</script>
<form on:submit|preventDefault={() => dispatch('search', query)}>…</form>

<!-- caller -->
<SearchBox on:search={(e) => run(e.detail)} />
```

```svelte
<!-- Svelte 5 -->
<script lang="ts">
  let { onsearch }: { onsearch?: (query: string) => void } = $props()
  let query = $state('')
</script>
<form
  onsubmit={(event) => {
    event.preventDefault()
    onsearch?.(query)
  }}
>…</form>

<!-- caller -->
<SearchBox onsearch={(q) => run(q)} />
```

`sv migrate` does not convert `createEventDispatcher` (it cannot see the callers), so do it by hand
and update every `on:<event>` on the component in the same change. `svelte/legacy` has
`preventDefault`, `stopPropagation`, `once`, `self`, `trusted`, `passive`, `nonpassive` wrappers for
the migration script's output; replace them with plain code.

Forwarding (`<button on:click>`) becomes accepting `onclick` and passing it on, or spreading props.

### Slots

| Svelte 4 | Svelte 5 child | Svelte 5 caller |
| --- | --- | --- |
| `<slot />` | `{@render children?.()}` | content between the tags |
| `<slot name="footer" />` | `{@render footer?.()}` | `{#snippet footer()}…{/snippet}` |
| `<slot name="item" {item} />` + `let:item` | `{@render item(entry)}` | `{#snippet item(entry)}…{/snippet}` |
| slot fallback content | `{#if footer}{@render footer()}{:else}…{/if}` | |
| `$$slots.footer` | `footer !== undefined` | |
| `<svelte:fragment slot="x">` | not needed | `{#snippet x()}` |

Snippets are values: they can be stored, passed down and typed with `Snippet<[Params]>`. A
component that uses `{@render}` cannot receive old-style `slot="…"` content; a component that still
uses `<slot>` can receive snippets.

### Component API

```js
// Svelte 4
const app = new App({ target, props: { user } })
app.$set({ user: next })
app.$on('logout', handler)
app.$destroy()
```

```js
// Svelte 5 (in a .svelte.js/.svelte.ts file, or with a helper from one, for $state)
import { flushSync, mount, unmount } from 'svelte'
const props = $state({ user, onlogout: handler })
const app = mount(App, { target, props }) // returns the component's exports
flushSync() // only if the caller expects onMount/effects to have run
props.user = next
unmount(app)
```

`mount` also accepts `context` (a `Map`), `intro` (default `true`) and `anchor`. `hydrate` takes
the same options plus `recover`. Since 5.50 `createContext` setters
work in a wrapper function passed to `mount` (`function Wrapper(...args) { setX(v); return C(...args) }`).

Types: `SvelteComponent`, `ComponentType` and `ComponentEvents` are deprecated; use
`Component<Props, Exports>` and `ComponentProps<typeof C>`.

### Lifecycle

`onMount` and `onDestroy` still work in runes mode. `beforeUpdate` maps to `$effect.pre`, and
`afterUpdate` to `$effect` (add `tick()` when you need the DOM after an update).

### Other behaviour changes worth knowing

- Whitespace between nodes collapses to one space and is trimmed at tag edges.
- `null` and `undefined` render as the empty string.
- `<Thing>` is dynamic: reassigning `Thing` re-renders. Dot notation (`<item.component>`) is a component.
- Attribute values that mix text and expressions must be quoted (`prop="a{b}"`).
- `ontouchstart`/`ontouchmove` attributes are passive.
- Scoped CSS uses `:where(.svelte-hash)`; `:is()`, `:has()` and `:where()` are now scoped.
- Bindings react to form `reset` events.

## 5.x minor releases that change how you should write code

| Version | Change |
| --- | --- |
| 5.3 | `<svelte:boundary>` error boundaries |
| 5.7 | `createSubscriber`, `MediaQuery` in `svelte/reactivity` |
| 5.16 | `class` accepts arrays and objects (clsx semantics) |
| 5.20 | `$props.id()` |
| 5.25 | deriveds are writable (override until a dependency changes) |
| 5.29 | `{@attach}` attachments; 5.32 adds `fromAction` to wrap old actions |
| 5.31 | `$state` fields declared by first assignment in a class constructor |
| 5.35 | `getAbortSignal()` |
| 5.36 | `await` in components and `$effect.pending()` behind `experimental.async`; `settled()` |
| 5.40 | `createContext()`; 5.57 adds a third `has` function |
| 5.41 | `$state.eager` (for async updates) |
| 5.44 | `hydratable` (async SSR) |
| 5.56 | declaration tags `{const …}` / `{let …}` in markup; `{@const}` is legacy |
| 5.57 | `SvelteMap#getOrInsert`/`getOrInsertComputed`, `defaultValue` on `<select>` |

## The migration script

`npx sv migrate svelte-5` (needs network access to fetch `sv`) bumps dependencies, converts `let`
to `$state`, `$:` to `$derived`/`$effect`/`run`, `export let` to `$props`, DOM `on:` to attributes,
slots to snippets, and obvious `new Component(...)` calls to `mount`. It does not convert
`createEventDispatcher` or `beforeUpdate`/`afterUpdate`, and it leaves `svelte/legacy` helpers to
clean up. It cannot know which props callers bind to, so check every `$bindable` it adds or omits.
