# ap-inbox

Accounts-payable inbox: vendor emails come in, invoices go out to the approval queue.
`extractInvoice()` turns one email body into an `Invoice` record for `queue.ts`.

```sh
npm test           # node --test, uses the AI SDK mock model, no network
npm run typecheck
```
