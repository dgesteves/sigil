# Sources

Checked on 2026-11-01 against `vue@3.5.44` (npm `latest`, published 2026-10-13; `3.6.0-rc.14` is
the `rc` tag). Tooling used for every verification run: `@vitejs/plugin-vue@6.0.10`,
`vitest@5.0.5`, `vite@8.3.5`, `jsdom@30.1.3`, `@vue/test-utils@2.5.1`,
`@testing-library/user-event@14.6.8`, `typescript@6.0.3`, `vue-tsc@3.3.14`, on Node 24
(`node:24-bookworm`). Compiler claims were checked by compiling snippets with
`@vue/compiler-sfc@3.5.44` and reading the output; runtime claims by running them in Vitest.

## Official documentation (vuejs.org, source in vuejs/docs `src/`)

- Props, reactive props destructure, passing destructured props into functions: https://vuejs.org/guide/components/props.html
- Component v-model, defineModel, modifiers: https://vuejs.org/guide/components/v-model.html
- `<script setup>` macros (defineProps, defineModel, defineEmits, defineExpose, defineOptions, defineSlots): https://vuejs.org/api/sfc-script-setup.html
- Component events and emits declaration: https://vuejs.org/guide/components/events.html
- Fallthrough attributes: https://vuejs.org/guide/components/attrs.html
- Watchers (deep as a number, once, onWatcherCleanup, flush timing, stopping): https://vuejs.org/guide/essentials/watchers.html
- Template refs and useTemplateRef: https://vuejs.org/guide/essentials/template-refs.html
- Composables, toValue, MaybeRefOrGetter: https://vuejs.org/guide/reusability/composables.html
- Composition API helpers (useTemplateRef, useId, useModel): https://vuejs.org/api/composition-api-helpers.html
- Application API (app.config.idPrefix, app.provide, app.runWithContext): https://vuejs.org/api/application.html
- Reactivity core and advanced (watch options, shallowRef, effectScope, onScopeDispose): https://vuejs.org/api/reactivity-core.html, https://vuejs.org/api/reactivity-advanced.html
- Provide / inject: https://vuejs.org/guide/components/provide-inject.html
- SSR guide and hydration mismatches: https://vuejs.org/guide/scaling-up/ssr.html
- SSR API (data-allow-mismatch values): https://vuejs.org/api/ssr.html
- Vue 3 migration guide (filters, transition classes, v-model, .sync, $listeners, events API, lifecycle and directive hook renames, v-if/v-for precedence, keyCode modifiers): https://v3-migration.vuejs.org/breaking-changes/

## Release notes (github.com/vuejs/core CHANGELOG.md)

- 3.5.0 (2024-09-03): reactive props destructure on by default, `useTemplateRef`, `useId` and
  `app.config.idPrefix`, `onWatcherCleanup`, numeric `deep`, `pause()`/`resume()` on watch handles,
  `data-allow-mismatch`, lazy hydration strategies, deferred Teleport, `onScopeDispose` failSilently
- 3.5.3 (2024-09-06): `useId` ids made selector-compatible (separator changed from `:` to `-`)
- 3.5.12 (2024-10-11): `useId` consistency with `serverPrefetch`
- 3.5.14 (2025-05-15): `TemplateRef` type export
- 3.5.25 (2025-11-24): warning when `provide()` is used after mounting
- 3.5.42 (2026-08-27): `.trim` kept when combined with `.number` on a component v-model
- 3.5.44 (2026-10-13): compile error when `defineModel` prop options reference a destructured prop;
  `once` watchers stop when their callback throws

## Runtime source read (vue 3.5.44, `@vue/runtime-core/dist/runtime-core.cjs.js`)

- `useModel`: local value when the parent does not pass both the prop and its `onUpdate:` listener
- `emit`: `.trim` / `.number` model modifiers applied to `update:*` payloads; undeclared-event warning
- `useId`: `(idPrefix || 'v') + '-' + …`
- hydration: attribute mismatches reported but not patched; text mismatches patched

## Where the docs and the package disagree

- The `app.config.idPrefix` example shows ids like `myApp:0`. Since 3.5.3 the separator is `-`
  (`myApp-0`), verified on 3.5.44.
- The guide says Vue's compiler "will throw a warning" for `watch(destructuredProp)`. On 3.5.44 it
  is a hard compile error, and so is `toRef(destructuredProp)`. Passing a destructured prop to any
  other function (your composables, `provide`) gets no diagnostic at all.
