# Sources

Checked on 2026-11-01 against `svelte@5.57.3` (npm `latest`, published 2026-10-26), with
`@sveltejs/vite-plugin-svelte@7.3.1`, `vite@8.3.5`, `vitest@5.0.5`, `jsdom@30.1.3`,
`svelte-check@4.7.7` and `typescript@6.0.3`, on Node 24. Every compile error, warning and runtime
behaviour named in this skill was reproduced by compiling or mounting code with those versions.

## Official documentation (svelte.dev, source in sveltejs/svelte `documentation/docs`, commit fe21fce of 2026-10-29)

- Runes: https://svelte.dev/docs/svelte/$state, /$derived, /$effect, /$props, /$bindable, /$inspect
- Svelte 5 migration guide: https://svelte.dev/docs/svelte/v5-migration-guide
- `.svelte.js` and `.svelte.ts` files: https://svelte.dev/docs/svelte/svelte-js-files
- Snippets and `{@render}`: https://svelte.dev/docs/svelte/snippet, https://svelte.dev/docs/svelte/@render
- Declaration tags (5.56): https://svelte.dev/docs/svelte/declaration-tags
- Attachments: https://svelte.dev/docs/svelte/@attach
- Context and `createContext`: https://svelte.dev/docs/svelte/context
- Stores: https://svelte.dev/docs/svelte/stores
- Imperative component API (`mount`, `hydrate`, `unmount`, `render`): https://svelte.dev/docs/svelte/imperative-component-api
- Testing: https://svelte.dev/docs/svelte/testing
- Best practices: https://svelte.dev/docs/svelte/best-practices
- `svelte/reactivity`: https://svelte.dev/docs/svelte/svelte-reactivity
- Compiler errors and warnings, runtime errors and warnings: https://svelte.dev/docs/svelte/compiler-errors, /compiler-warnings, /runtime-errors, /runtime-warnings

## Release notes

- `packages/svelte/CHANGELOG.md` in sveltejs/svelte, read for 5.3 to 5.57.3 (versions in the
  migration reference's table come from it).
- `@sveltejs/kit@3.1.1` peer dependencies on npm (`svelte ^5.57.1`, `vite ^8.0.12`,
  `@sveltejs/vite-plugin-svelte ^7.0.0`, `typescript ^6.0.0`).
- The `sv@1.2.0` project templates (forced `runes` compiler option).

## Where the docs and the package disagree or say less

- The docs list a `bind_not_bindable` runtime error for binding to a prop without `$bindable`. In
  5.57.3 the error function exists but nothing calls it: the binding fails silently (the parent's
  variable never updates). Verified with a parent `bind:value` on a non-bindable child prop.
- The testing guide suggests `resolve.conditions: ['browser']`. That is enough: `mount` works and
  Svelte's dev checks stay on (`esm-env` `DEV` was `true`).
- `createRawSnippet` renders only the first element its `render()` returns; extra siblings are
  dropped without an error.
- "Effects run after mount" is documented for `onMount` and `$effect`; the same deferral applies to
  `bind:this` assignments, so component exports that use a bound element throw if called before
  `flushSync()`.
