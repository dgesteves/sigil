# storefront-web

The storefront's Svelte UI: product cards, the cart badge and the cart drawer.

```sh
npm test        # vitest + jsdom
npm run check   # svelte-check
```

- `src/lib/cart.ts`: cart state (persisted to localStorage under `cart:v1`)
- `src/lib/checkout.ts`: builds the order payload posted to the payment iframe
- `src/lib/analytics.ts`: pushes events to `window.dataLayer`

Runes mode is on for every component in this repo (see `svelte.config.js`).
