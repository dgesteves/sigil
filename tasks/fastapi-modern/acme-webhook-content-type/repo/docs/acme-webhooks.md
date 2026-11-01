# Acme Pay webhooks

Acme delivers each event as an HTTP POST with a JSON body and retries with backoff until it gets a
2xx. The body is signed: `X-Acme-Signature: sha256=<hex HMAC-SHA256 of the raw body>` using the
webhook secret from the Acme dashboard.

Acme's sender does not set a `Content-Type` header, and their support confirmed it will stay that way
for API version 2025-06. A delivery captured from their sandbox on 2026-10-27:

```http
POST /webhooks/acme-pay HTTP/1.1
Host: payments.internal
User-Agent: AcmePay-Webhooks/4.2
Content-Length: 142
X-Acme-Signature: sha256=<hmac of the body>
Accept: */*

{"id":"evt_9fK2mQ7xLp","type":"payment.succeeded","order_id":"ord_1042","amount_cents":4599,"currency":"EUR","created":"2026-10-27T09:14:03Z"}
```

Acme's integration dashboard imports our `/openapi.json` and checks the documented request body of
`POST /webhooks/acme-pay` against their event schema, so the endpoint has to stay in the spec with its
`PaymentEvent` body.
