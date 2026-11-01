# Vue 2 and early Vue 3 habits, with what each one does on 3.5

"Verified" means the old idiom was compiled and run with vue 3.5.44 (no `@vue/compat`) and the
result observed. Everything else is from the official migration guide (v3-migration.vuejs.org).

## Silent: compiles, runs, does the wrong thing

| Vue 2 idiom | On 3.5 | Port to |
| --- | --- | --- |
| `props: ['value']`, `this.$emit('input', v)` | parent `v-model` passes `modelValue` and listens to `update:modelValue`: nothing binds (verified) | `defineModel()`, or `modelValue` + `update:modelValue` |
| `model: { prop, event }` option | ignored | `defineModel('prop')` + `v-model:prop` |
| `:title.sync="t"` | `.sync` dropped, `title` bound one-way, `update:title` unheard (verified, no warning) | `v-model:title="t"` |
| `@click.native="fn"` | `.native` dropped; `fn` is a normal component listener (verified) | `@click`; declare `click` in the child's emits only if the child emits it |
| emitting `click`/`input`/`change` without declaring it | handler runs twice: once natively via fallthrough, once from the emit (verified) | declare every emitted event |
| `v-on="$listeners"` on an inner element | `$listeners` is `undefined` (verified); listeners are in `$attrs` | `v-bind="$attrs"` |
| `inheritAttrs: false` but `class` still on the root | Vue 3 puts `class` and `style` in `$attrs` too, so they move with `v-bind="$attrs"` (verified) | decide where class should land; bind it explicitly if needed |
| `beforeDestroy()`, `destroyed()` | never called, no warning (verified): timers and listeners leak | `beforeUnmount()`, `unmounted()`, or `onScopeDispose` |
| directive hooks `bind`, `inserted`, `componentUpdated`, `unbind` | never called (verified) | `beforeMount`, `mounted`, `updated`, `unmounted` |
| `watch: { list() {} }` on an array, expecting `push` to fire | fires only when the array is replaced (verified) | `list: { handler, deep: true }` |
| `@keyup.13` keyCode modifiers | never fire (verified) | `@keyup.enter`, `@keydown.page-down` |
| `{{ amount \| currency }}` filters | compiles as JavaScript bitwise OR and renders a number (verified) | `{{ currency(amount) }}` or a computed |
| `id="a" v-bind="obj"` relying on the explicit attribute to win | the later one wins: `v-bind="{ id: 'b' }"` after `id="a"` gives `b`, before it gives `a` (verified) | order attributes deliberately |
| transition classes `.v-enter`, `.v-leave` | not applied, so there is no start state | `.v-enter-from`, `.v-leave-from` |
| `this.value.push(x)` / `splice` on a prop array | mutates parent state, emits nothing; `TypeError` on frozen data (verified) | emit a new array |
| `this.$set(obj, 'k', v)`, `Vue.set`, `Vue.delete` | `this.$set` is `undefined` → `TypeError` (verified); `Vue.set` is not exported | plain assignment / `delete obj.k`; Vue 3 proxies track them |

## Loud: fails at compile time or throws

| Vue 2 idiom | On 3.5 | Port to |
| --- | --- | --- |
| `v-if` and `v-for` on the same element | `v-if` is evaluated first: `TypeError` reading the loop variable (verified) | `<template v-for>` with `v-if` inside, or filter in a computed |
| key on children of `<template v-for>` | compile error "<template v-for> key should be placed on the <template> tag." (verified) | `<template v-for="i in items" :key="i.id">` |
| `this.$on`, `$off`, `$once` event bus | `undefined` → `TypeError` (verified) | callback props, provide/inject, or a small emitter (mitt) |
| `this.$children` | `undefined` (verified) | template refs |
| `this.$scopedSlots` | `undefined` (verified) | `this.$slots` (all slots are functions) |
| `new Vue({ render: h => h(App) }).$mount('#app')` | no default export to construct | `createApp(App).mount('#app')` |
| `Vue.component/use/mixin/directive/prototype` | not on the global | `app.component/use/mixin/directive`, `app.config.globalProperties` |
| `render(h) { return h('div') }` | `h` is not passed | `import { h } from 'vue'` |
| `functional: true` components with templates | not supported | plain functions or normal components |
| `slot="name"`, `slot-scope="props"` | removed | `<template #name="props">` |
| `propsData` (mount option, tests) | removed | `props` |

## Early Vue 3 (3.0-3.4) habits that are now outdated

| Habit | Since | Now |
| --- | --- | --- |
| `const props = defineProps(); const x = toRef(props, 'x')` everywhere | 3.5 | destructure `const { x } = defineProps()`; pass `() => x` to functions |
| `withDefaults(defineProps<…>(), { items: () => [] })` | 3.5 | `const { items = [] } = defineProps<…>()` |
| `modelValue` prop + `update:modelValue` emit + computed get/set | 3.4 | `defineModel()` (adds local mode) |
| `const input = ref(null)` matched by template ref name | 3.5 | `useTemplateRef('input')` (old form still works) |
| `watch(src, async (v, o, onCleanup) => …)` | 3.5 | `onWatcherCleanup()` before the first await (the argument form still works) |
| manual id counters for labels | 3.5 | `useId()` + `app.config.idPrefix` |
| `unref(x)` in composables | 3.3 | `toValue(x)`, which also calls getters |
| `defineComponent({ name, inheritAttrs })` beside `<script setup>` | 3.3 | `defineOptions({ name, inheritAttrs })` |
| assuming destructured props are frozen (3.4 behaviour) | 3.5 | they are reactive where they are read; the getter rule still applies when passing them on |

## Porting procedure

1. Confirm versions: `npm ls vue @vue/compiler-sfc @vitejs/plugin-vue @vue/test-utils`.
2. Grep for the silent rows first; types and the compiler will not catch them:

   ```sh
   rg -n -e '\$listeners' -e '\.sync\b' -e '\.native\b' -e beforeDestroy -e 'destroyed\(' -e '\$set\(' -e '\$on\(' -e '\$children' -e '\$scopedSlots' src
   ```

   Then search by hand for `$emit('input'`, `@keyup.13`-style modifiers, filters inside `{{ }}`,
   `.v-enter` / `.v-leave` in styles, and `.push(` / `.splice(` on props.

3. For each component, list its public contract (props, emitted events, slots, `v-model` names,
   exposed methods) before changing it, and keep that contract.
4. Declare emits on every component; then check that each parent's listener fires once.
5. Move cleanup to `beforeUnmount`/`unmounted`/`onScopeDispose` and check it runs (unmount in a test).
6. Run the tests, then exercise uncontrolled usage (no `v-model`) and frozen or readonly inputs.
