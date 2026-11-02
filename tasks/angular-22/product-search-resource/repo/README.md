# storefront

Customer-facing catalogue. Angular 22, zoneless, tests on Vitest.

```sh
npm start     # ng serve
npm test      # ng test --watch=false (Vitest + jsdom)
npm run build
```

All API calls go through `HttpClient`; `authInterceptor` adds the session token.
