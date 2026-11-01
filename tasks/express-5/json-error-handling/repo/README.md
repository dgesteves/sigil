# orders-api

Order intake service. `src/orders-repo.mjs` is the in-memory repository used in development and tests;
production swaps in the Postgres repository with the same interface.

```sh
npm start
npm test
```
