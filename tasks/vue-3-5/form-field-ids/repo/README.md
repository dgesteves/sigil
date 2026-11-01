# account-web

The account settings page, server-rendered by a long-running Node process and hydrated in the
browser. The header search bar is a separate Vue app on the same page.

```sh
npm test           # vitest + jsdom + @vue/test-utils
npm run typecheck  # vue-tsc --noEmit
```

- `src/apps.ts`: app factories, shared by the server and the browser.
- `src/entry-server.ts`: `renderPage()` renders both apps into the page shell for one request.
- `src/entry-client.ts`: `hydratePage()` hydrates both apps in the browser.
- `src/components/`: form fields shared by both apps.
