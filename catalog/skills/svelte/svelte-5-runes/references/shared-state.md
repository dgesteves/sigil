# Shared state with runes

Checked against svelte 5.57.3. The examples use a media-player domain; adapt the names.

## Choosing a shape

| Need | Shape |
| --- | --- |
| One app-wide object, mutated in place | `export const prefs = $state({ volume: 0.8, muted: false })` |
| State plus behaviour and derived values | a class with `$state`/`$derived` fields, exported as an instance and as the class (for tests) |
| A value that is reassigned (primitives, replaced arrays) | keep it private and export getter/setter functions, or put it in a class |
| Per-request or per-subtree state (SSR, several widgets on one page) | a class instance provided through `createContext` |
| A value fed by something outside Svelte (events, media queries, sockets) | `createSubscriber`, or `MediaQuery` for media queries |

All of these live in `.svelte.ts`/`.svelte.js` files (or in components). Runes in plain `.ts` throw
`rune_outside_svelte` when the module runs.

## Classes

```ts
// queue.svelte.ts
export interface Song {
  id: string
  title: string
  durationSec: number
}

export class Queue {
  songs = $state<Song[]>([])
  current = $state(0)
  nowPlaying = $derived(this.songs[this.current])
  remainingSec = $derived(
    this.songs.slice(this.current).reduce((sum, t) => sum + t.durationSec, 0),
  )

  enqueue(song: Song) {
    this.songs.push(song) // array methods on a $state array are reactive
  }

  skip = () => {
    // an arrow function keeps `this` when passed as onclick={queue.skip}
    this.current = Math.min(this.current + 1, this.songs.length - 1)
  }

  toJSON() {
    // $state fields are accessors on the prototype: JSON.stringify(queue) would give {}
    return { songs: this.songs, current: this.current }
  }
}

export const queue = new Queue()
```

- `$derived` fields are computed lazily and are correct immediately after a method returns, in
  components, in plain functions and in tests, with no flush.
- Never compute fields in `$effect`. An `$effect` in the constructor throws `effect_orphan` when the
  instance is created outside a component (module-level singletons fail at import), and even inside
  a component the value is stale until effects run.
- Private fields work too: `#songs = $state([])` with `get songs() { return this.#songs }`.
- Since 5.31 the first assignment in the constructor can declare state: `this.title = $state(title)`.
- `$state(new Queue())` does nothing extra: only plain objects and arrays are proxied.

## Exporting module state

```ts
// prefs.svelte.ts
export const prefs = $state({ volume: 0.8, muted: false }) // fine: the binding is never reassigned

let sessionId = $state<string | null>(null) // reassigned below, so not exported directly
export const getSessionId = () => sessionId
export function startSession(id: string) {
  sessionId = id
}
```

`export let sessionId = $state(null)` with `sessionId = id` anywhere in the module is the compile
error `state_invalid_export`: importers would receive the signal object, not the value. Exporting a
`$derived` is `derived_invalid_export`; export a function or a getter that returns it.

## Values, copies and reactivity

- `const { current } = queue` copies a number. Read `queue.current` where you need it.
- A function that returns `{ count }` built from `let count = $state(0)` returns the value at call
  time (and triggers `state_referenced_locally`). Return getters:
  `return { get count() { return count }, increment: () => count++ }`.
- Passing state to a helper: pass the object (`progress(queue)`) or a function (`() => queue.current`).
- `$derived` over an object returns it as-is (not proxied). Mutating it mutates the source if the
  source was a proxy.

## Built-in collections

`$state(new Map())`, `$state(new Set())` and `$state(new Date())` are not reactive: `.set()`,
`.add()` and `.setTime()` change nothing on screen, and `$derived` values computed from them never
recompute. Use the reactive versions from `svelte/reactivity`:

```ts
import { SvelteMap, SvelteSet } from 'svelte/reactivity'

export class Library {
  byId = new SvelteMap<string, Song>()
  favourites = new SvelteSet<string>()
  count = $derived(this.byId.size)
  favouriteSongs = $derived([...this.favourites].map((id) => this.byId.get(id)!).filter(Boolean))
}
```

They don't need `$state` around them. Values stored in a `SvelteMap` are not made deeply reactive;
replace an entry (`map.set(id, { ...song, title })`) to update it. `SvelteMap#getOrInsert` and
`getOrInsertComputed` exist since 5.57. The alternative is reassigning a new collection
(`ids = new Set([...ids, id])`).

## Snapshots and serialisation

| Operation on `$state` data | Result |
| --- | --- |
| `JSON.stringify(state)` | works (reads through the proxy) |
| `JSON.stringify(classInstance)` | `{}` unless the class has `toJSON()` |
| `structuredClone(state)`, `postMessage(state)`, IndexedDB `put(state)`, `history.pushState(state)` | `DataCloneError` |
| `$state.snapshot(state)` | a plain deep copy (uses `toJSON` when present) |
| `{ ...item }` of a proxied object | a plain shallow copy |

`$state.snapshot` is a rune: inside plain `.ts` files, copy the data out by hand
(`list.map((x) => ({ ...x }))`) or expose a method from the `.svelte.ts` module that snapshots.

## Persistence

```ts
export class Settings {
  theme = $state<'light' | 'dark'>('light')
  #storage: Pick<Storage, 'getItem' | 'setItem'> | null

  constructor(storage = typeof localStorage === 'undefined' ? null : localStorage) {
    this.#storage = storage
    const saved = storage?.getItem('settings')
    if (saved === 'dark' || saved === 'light') this.theme = saved
  }

  setTheme(theme: 'light' | 'dark') {
    this.theme = theme
    this.#storage?.setItem('settings', theme) // saved synchronously, works anywhere
  }
}
```

If many mutation paths make explicit saves error-prone, own an effect root and keep its cleanup:

```ts
this.dispose = $effect.root(() => {
  $effect(() => {
    storage?.setItem('settings', JSON.stringify({ theme: this.theme }))
  })
})
```

Effect-based saves run in a microtask after the change, not synchronously. Guard `localStorage` for
SSR, and wrap `JSON.parse` of stored data in `try`.

## Stores: keep, bridge or replace

- `svelte/store` is not deprecated. `writable`, `readable`, `derived`, `get`, `readonly` still work,
  and `$store` auto-subscription works in runes components.
- `$store` syntax is not available in `.svelte.ts` modules (`store_invalid_subscription_module`).
- `fromStore(store)` gives `{ current }` backed by the store; `toStore(() => value, set?)` turns
  runes state into a store for code that expects one.
- Replacing a store module: keep the public surface explicit, port consumers in the same change,
  and replace `get(store)` with direct reads. Watch for code that relied on store values being
  plain objects (now proxies) and on `subscribe` running immediately (now: explicit saves or an
  effect root).

## Context instead of module singletons

Module state is shared by every user during server rendering. When state depends on the request
or must exist once per widget, create it in a component and provide it through context:

```ts
// player-context.ts
import { createContext } from 'svelte'
import type { Queue } from './queue.svelte.ts'

export const [getQueue, setQueue, hasQueue] = createContext<Queue>()
```

```svelte
<!-- Player.svelte -->
<script lang="ts">
  import { Queue } from './queue.svelte.ts'
  import { setQueue } from './player-context.ts'
  let { children } = $props()
  setQueue(new Queue())
</script>
{@render children?.()}
```

`createContext` (5.40+) returns typed `[get, set]` functions, plus `has` since 5.57. Context must be
set and read during component initialisation. Mutate the object you provided; reassigning the
variable in the parent does not reach children that already read it.

## External sources

```ts
import { createSubscriber } from 'svelte/reactivity'

export class OnlineStatus {
  #subscribe = createSubscriber((update) => {
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  })
  get current() {
    this.#subscribe() // only subscribes while something reactive reads `current`
    return navigator.onLine
  }
}
```

`new MediaQuery('(min-width: 60rem)')` from `svelte/reactivity` exposes `.current` the same way.
`svelte/reactivity/window` has ready-made values such as `innerWidth` and `online`.
