# Reactivity, watchers, effect scopes and composables

Checked against vue 3.5.44. "Verified" rows were run in Vitest 5 with jsdom.

## ref, reactive, shallow variants

| API | Tracks | Notes |
| --- | --- | --- |
| `ref(x)` | `.value`, and deeply inside objects/arrays it holds | Objects are wrapped with `reactive()` on assignment |
| `shallowRef(x)` | `.value` only | `list.value.push(1)` triggers nothing (verified); assign a new value or call `triggerRef(list)` |
| `reactive(obj)` | every property, deeply | Destructuring (`const { a } = state`) copies values; use `toRefs(state)` |
| `shallowReactive(obj)` | top-level properties | Nested objects stay plain |
| `readonly(x)` | as the source | Writes warn in development and are ignored |
| `markRaw(obj)` | never | For class instances, maps from third-party SDKs, large immutable data |

- `reactive()` returns a proxy; `toRaw()` gets the original. Identity comparisons between a raw
  object and its proxy fail, so compare ids, not objects.
- Refs are unwrapped inside `reactive` objects but **not** inside reactive arrays or `Map`s:
  `reactive([ref(1)])[0]` is still a ref (verified).
- `computed(getter)` is cached and lazy. Keep getters pure: no fetches, no writes.
  `computed({ get, set })` makes it writable (useful for wrapping store state for `v-model`).
  Since 3.4 the getter receives the previous value: `computed((prev) => …)` (verified).
- Large immutable data (thousands of rows you only replace): `shallowRef` and replace the array.
  It avoids creating a proxy per row.

## Watch sources and depth

Verified on 3.5.44:

| Watch | `list.value.push()` / `state.items.push()` | nested write `state.nested.a.b = 2` | replace `state.nested.a = {}` |
| --- | --- | --- | --- |
| `watch(listRef, cb)` | no | n/a | n/a |
| `watch(listRef, cb, { deep: true })` | yes | yes | yes |
| `watch(state, cb)` (reactive) | yes (implicit deep) | yes | yes |
| `watch(() => state.items, cb)` | no | n/a | n/a |
| `watch(() => state.nested, cb, { deep: 1 })` | n/a | no | yes |
| `watch(() => state.nested, cb, { deep: 2 })` | n/a | yes | yes |

- Several sources: `watch([a, () => b.value], ([newA, newB], [oldA, oldB]) => …)`. On the
  `immediate` run the old-value array is empty (`[]`), so `oldA` and `oldB` are `undefined`.
- `deep: true` traverses the whole structure on every trigger. On big objects use a getter for the
  field you care about, or a numeric `deep`.
- `once: true` (3.4) runs the callback once and stops the watcher. Since 3.5.44 a `once` watcher
  also stops when its callback throws.

## Timing

- `immediate: true`: the callback runs synchronously inside the `watch()` call (verified).
- Default `flush: 'pre'`: callbacks are queued and run before the next component update, also when
  there is no component (a plain `effectScope`). After a write, the callback has not run yet; it runs
  on the next microtask. `await nextTick()` in tests (verified).
- `flush: 'post'` (or `watchPostEffect`) runs after the DOM is patched. `flush: 'sync'` (or
  `watchSyncEffect`) runs on every write without batching; never use it on arrays mutated in loops.
- Watchers created synchronously in `setup()`, `<script setup>` or inside `effectScope().run()`
  belong to that scope and stop with it. A watcher created after an `await` belongs to nothing: keep
  the handle and call `stop()` yourself.

## Handles: stop, pause, resume

```ts
const handle = watch(source, cb)
handle.pause()   // changes are remembered, the callback does not run
handle.resume()  // if something changed while paused, the callback runs once (verified)
handle.stop()
```

`watchEffect` returns the same handle. Pausing is useful for hidden tabs or offscreen widgets.

## Cleanup

Three ways, all run before the next invocation and when the watcher stops:

```ts
// 1. onWatcherCleanup (3.5): must be called synchronously, before the first await.
watch(id, (value) => {
  const controller = new AbortController()
  onWatcherCleanup(() => controller.abort())
  void load(value, controller.signal)
})

// 2. The onCleanup argument: bound to the watcher, so it also works after an await.
watch(id, async (value, _old, onCleanup) => {
  const controller = new AbortController()
  onCleanup(() => controller.abort())
  await load(value, controller.signal)
})

// 3. watchEffect gets onCleanup as its first argument.
watchEffect((onCleanup) => {
  const timer = setInterval(tick, 1000)
  onCleanup(() => clearInterval(timer))
})
```

Calling `onWatcherCleanup()` after an `await` logs "onWatcherCleanup() was called when there was no
active watcher to associate with." and registers nothing (verified): the request is never aborted
and the timer leaks. `onWatcherCleanup(fn, true)` silences the warning but still registers nothing.

`getCurrentWatcher()` (3.5) returns the running watcher's effect, for helpers that want to attach
cleanup themselves.

## watchEffect and await

`watchEffect` tracks only what it reads before its first `await`:

```ts
watchEffect(async () => {
  const q = query.value           // tracked
  const res = await search(q)
  results.value = filter(res, mode.value) // NOT tracked: read after the await
})
```

Read every input synchronously at the top, or use `watch` with explicit sources.

## Effect scopes

```ts
const scope = effectScope()
const api = scope.run(() => {
  const visible = usePageVisibility()
  const forecast = useForecast(() => city.value)
  return { visible, forecast }
})!
scope.stop() // stops every watcher and computed created inside, runs their cleanup and onScopeDispose callbacks
```

- `onScopeDispose(fn)` registers cleanup on the active scope: a component's scope inside `setup`, or
  the scope you created. Use it in composables instead of `onUnmounted`, which only exists inside a
  component's `setup` and warns elsewhere. Since 3.5, `onScopeDispose(fn, true)` does not warn when
  there is no active scope.
- `effectScope(true)` creates a detached scope that is not collected by the parent scope; you must
  stop it.
- Pinia setup stores, VueUse and other libraries run composables inside scopes, which is why
  reusable composables must not depend on component lifecycle hooks or `getCurrentInstance()`.

## Composable checklist

1. Inputs typed `MaybeRefOrGetter<T>`; read with `toValue()` inside the effect, or watch the
   getter `() => toValue(input)`. `toRef(input)` normalises to a ref (a getter becomes a readonly
   ref) when you need a ref.
2. Outputs: plain object of refs (`readonly()` them if callers must not write). Never return a
   `reactive()` that callers will destructure.
3. Side effects (timers, listeners, requests) created in a watcher with cleanup, or in the
   composable body with `onScopeDispose`.
4. Async: abort or ignore superseded work; clear stale state when the input changes if showing it
   would be wrong (another user's data, another city's forecast).
5. Called synchronously at the top of `setup` or of another composable. In a `setup()` function, a
   composable called after an `await` has no current instance or scope. `<script setup>` is the
   exception: the compiler restores the instance after a top-level `await`.
6. Callers pass props as getters: `useThing(() => props.id)` or, with destructured props,
   `useThing(() => id)`.
