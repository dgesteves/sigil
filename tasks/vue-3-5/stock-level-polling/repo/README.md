# storefront-widgets

Vue 3 widgets that the storefront embeds on product and cart pages.

```sh
npm test           # vitest + jsdom + @vue/test-utils
npm run typecheck  # vue-tsc --noEmit
```

- `src/api.ts` talks to the inventory service. `fetchStock` accepts an `AbortSignal`.
- `src/components/` holds the widgets, `src/composables/` the shared logic.
- The cart drawer's Pinia store reuses composables from `src/composables/` inside its own
  `effectScope()`, outside any component.
