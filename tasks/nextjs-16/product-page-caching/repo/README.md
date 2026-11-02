# Corner Shop

The storefront for Corner Shop, on Next.js 16 with Cache Components enabled.

```sh
npm run dev     # http://localhost:3000
npm run build
npm test        # builds, then runs the integration tests in test/ against `next start`
```

- `lib/db.ts` is the catalog database client. Locally the catalog is `data/catalog.json` and every
  read is logged to `data/reads.log`.
- Shoppers browse `/` and `/products/[id]`. The cart lives in the `cart` cookie
  (`p-100:2,p-300:1`).
- Staff edit prices at `/admin/products/[id]` (signed in via the `staff_session` cookie from SSO).
- The warehouse calls `POST /api/inventory` after it updates stock levels in the database. It sends
  the `x-inventory-secret` header (`INVENTORY_WEBHOOK_SECRET`) and `{ "productIds": [...] }`.
