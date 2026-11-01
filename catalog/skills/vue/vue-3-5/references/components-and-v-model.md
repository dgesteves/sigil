# Components: props, defineModel, emits, attrs, slots, refs, ids and SSR

Checked against vue 3.5.44 and @vue/compiler-sfc 3.5.44.

## Props

```ts
const {
  title,
  size = 'md',
  disabled,            // optional boolean: absent means false, not undefined
  items = [],          // compiled to default: () => ([])
} = defineProps<{
  title: string
  size?: 'sm' | 'md' | 'lg'
  disabled?: boolean
  items?: Item[]
}>()
```

- **Boolean casting.** A prop typed `boolean` is `false` when absent and `true` for a bare attribute
  (`<Btn disabled />`) (verified). If "not set" must differ from `false`, give it an explicit
  `undefined` default (`withDefaults(defineProps<{ x?: boolean }>(), { x: undefined })`, verified)
  or use a string union.
- Destructured defaults for objects and arrays become factories (verified in the compiled output).
  In `withDefaults` and runtime `props` declarations you still write `() => []` yourself.
- What the compiler rewrites: every reference to a destructured name in the same `<script setup>`.
  What it cannot fix: passing the name somewhere (`useThing(title)`, `provide(K, title)`,
  `someArray.push(title)`) passes the current value. Wrap in a getter.
- Compile errors (not runtime): `watch(title, …)`, `toRef(title)`, `title = 'x'`,
  `defineModel({ default: title })`. The last one appeared in 3.5.44; the fix is
  `default: (props) => props.title`.
- Props are shallow-readonly. Nested objects are not: `items[0].done = true` mutates the parent's
  object silently. Emit an event or a new object instead.
- Runtime validation (`validator`, `required`) warns in development only.

## defineModel in detail

What `const model = defineModel<string>()` compiles to (verified):

```js
props: { modelValue: { type: String }, modelModifiers: {} },
emits: ['update:modelValue'],
setup(__props) { const model = _useModel(__props, 'modelValue') }
```

Runtime behaviour of the returned ref (from `useModel` in runtime-core 3.5.44, verified):

| Parent | `model.value = x` does |
| --- | --- |
| `v-model="v"` (passes `modelValue` **and** `onUpdate:modelValue`) | emits `update:modelValue`; the child shows `x` once the parent updates the prop |
| only `@update:model-value="fn"` | sets a local value (re-renders) and emits |
| only `:model-value="v"` | sets a local value and emits; a later prop change from the parent overwrites it |
| nothing | sets a local value; the emit has no listener |

- Setting the same value again (`hasChanged` is false) emits nothing.
- `get`/`set` transforms: `get(v)` maps what the child reads, `set(v)` maps what is emitted.
  Modifiers are read inside them:

  ```ts
  const [code, modifiers] = defineModel<string, 'upper'>({
    set: (v) => (modifiers.upper ? v.toUpperCase() : v),
  })
  ```

- Named models: `defineModel('start')` + `defineModel('end')` pair with
  `v-model:start` / `v-model:end`; their modifiers arrive as `startModifiers` / `endModifiers`.
- `.trim` and `.number` on a component `v-model` are applied by Vue's `emit()` to string arguments
  of the `update:*` event (verified): the child does not implement them.
- Typing: `defineModel<T>({ required: true })` removes `undefined` from the type;
  `defineModel<T, 'a' | 'b'>()` types the modifiers.
- Object or array models: read `model.value`, build a new value, assign it. `push`, `splice`,
  `model.value.name = …` write into the parent's state without an event (verified: no emit, no
  re-render for non-reactive defaults, `TypeError` on frozen arrays, and a non-factory default
  leaks into instances mounted later).

The manual equivalent (still correct, but no local mode):

```ts
const props = defineProps<{ modelValue: string; modelModifiers?: { upper?: boolean } }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const value = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', props.modelModifiers?.upper ? v.toUpperCase() : v),
})
```

If a component must also work without `v-model`, the manual version needs its own local ref that
mirrors the prop when the parent passes it. `defineModel` already does exactly that.

## Emits

- Declared events are not attributes. Undeclared ones are: a parent's `@close` becomes an
  `onClose` attribute that falls through to the root element. For DOM event names this means the
  handler runs for the native event **and** for the emit (verified: two calls per click with
  `$emit('click')` and no declaration, one call with `defineEmits<{ click: [] }>()`).
- The emits validator form `emits: { submit: (payload) => isValid(payload) }` warns in
  development when it returns false.
- `defineEmits` type syntax: `defineEmits<{ select: [id: string, index: number] }>()`.
- The development warning "Component emitted event "x" but it is neither declared in the emits
  option nor as an "onX" prop" points at a missing declaration.
- Listen with kebab-case in templates (`@update:model-value` and `@update:modelValue` both work in
  SFC templates; in in-DOM templates only kebab-case works).

## Attributes

- `$attrs` / `useAttrs()` contains every attribute and listener that is not a declared prop or
  emit, **including `class` and `style`** (Vue 2 kept those apart). `$listeners` is gone.
- Single-root components get `$attrs` on the root automatically. Multi-root components (fragments)
  get nothing and warn "Extraneous non-props attributes" (verified); bind `v-bind="$attrs"` where
  they belong.
- `defineOptions({ inheritAttrs: false })` + `v-bind="$attrs"` on an inner `<input>` moves class,
  style, `id` and listeners to the input (verified).
- `useAttrs()` is not reactive in the `watch` sense; read it in a render or `onBeforeUpdate`.

## Slots

- `$slots.name` / `useSlots().name` are functions returning vnodes. Vue 2's `$scopedSlots` is merged
  into `$slots`.
- `v-slot` / `#name` is the only syntax; `slot="name"` and `slot-scope` were removed.
- Type them with `defineSlots<{ default(props: { item: Item }): any; empty(): any }>()`.

## Template refs and exposure

- `useTemplateRef<T>('key')` (3.5) returns a shallow readonly ref bound to `ref="key"`. It is
  `null` until mounted and after unmount; read it in `onMounted` or after `await nextTick()`.
- In `v-for`, a ref is an array of elements or instances, and the order is not guaranteed to match
  the source array (verified length; order caveat is from the docs).
- `<script setup>` instances are closed to parents: a parent's template ref sees no methods unless
  the child calls `defineExpose()` (verified: `undefined` without it). @vue/test-utils' `wrapper.vm`
  can still reach internals, so a passing unit test does not prove a parent can call it.
- Function refs: `:ref="(el) => …"` runs with `null` on unmount.

## useId, idPrefix and SSR hydration

- `useId()` returns `${idPrefix ?? 'v'}-${n}` (3.5.44 source; verified `v-0`, `v-1`, and
  `widget-0` with `app.config.idPrefix = 'widget'`). The docs page still shows `myApp:0`: the
  separator changed to `-` in 3.5.3 so ids work in CSS selectors.
- Ids are counted per app along the component tree, so they are identical on every request, for
  concurrent requests and during hydration. Async boundaries (`async setup`, `serverPrefetch`) are
  accounted for (fixes in 3.5.0 and 3.5.12).
- Unsafe id sources and what happens (all verified with a server render followed by hydration):
  - `let n = 0` in a plain `<script>` block: module-level, so the long-lived server keeps counting
    across requests while the browser starts at 1: attribute mismatch warnings.
  - `let n = 0` inside `<script setup>`: per instance, so every field gets the same id: duplicate ids.
  - `Math.random()`, `crypto.randomUUID()`, `Date.now()`: mismatch on every hydration.
  - `getCurrentInstance().uid`: a global counter shared by every app and request: mismatches.
  - A global counter reset at the start of each render: breaks under concurrent requests
    (verified: interleaved `renderToString` calls produce different markup).
- Attribute mismatches are reported but not patched: the DOM keeps the server values while the
  client's vnodes hold different ids, so later `aria-describedby` updates or
  `document.getElementById(id)` miss. Text mismatches, by contrast, are patched (runtime-core
  source, also in the production build).
- Two apps on one page: give each its own `app.config.idPrefix`, set in the factory that both the
  server entry and the client entry call.
- `data-allow-mismatch` (3.5) on an element suppresses warnings for that element only; values
  `text`, `children`, `class`, `style`, `attribute`, or empty for all (verified for `text`).
- Lazy hydration (3.5): `defineAsyncComponent({ loader, hydrate: hydrateOnVisible() })`, also
  `hydrateOnIdle`, `hydrateOnInteraction('click')`, `hydrateOnMediaQuery(query)`.
- `<Teleport defer to="#target">` (3.5) resolves its target after the current render, so the
  target may be rendered later in the same tree.

## provide/inject

- Type keys: `const ThemeKey: InjectionKey<Ref<Theme>> = Symbol('theme')`; `inject(ThemeKey)` is
  then typed `Ref<Theme> | undefined`.
- Provide reactive things: a `ref`, `computed`, `readonly(ref)` or `toRef(() => prop)`. Providing
  `props.theme` or a destructured prop provides a snapshot (verified: the child kept showing
  `light` after the parent's prop changed to `dark`).
- Keep mutations with the owner: provide `readonly(state)` plus functions that change it.
- Defaults: `inject(Key, fallback)`; for expensive or object defaults use a factory and pass `true`
  as the third argument: `inject(Key, () => new Map(), true)`.
- `inject()` only works synchronously in `setup` (or in `app.runWithContext()`); `app.provide()`
  provides to a whole app.
