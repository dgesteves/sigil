# dispatch-board

Live order queue for the dispatch team. Angular 22, zoneless (zone.js was removed in the v22
upgrade), tests on Vitest.

```sh
npm start     # ng serve
npm test      # ng test --watch=false (Vitest + jsdom)
npm run build
```

The live feed is a WebSocket wrapped by `OrderFeed` (src/app/feed/order-feed.ts).
