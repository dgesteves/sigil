# Statement API contract

`GET /statements/{id}` returns one JSON object. The mobile app and the customer portal were built
against this document; the field names, types and omissions below are the contract.

```json
{
  "statementId": "ST-2026-10-000412",
  "accountId": "ACC-88213",
  "period": { "start": "2026-10-01", "end": "2026-10-31" },
  "issuedAt": "2026-11-01T06:00:00Z",
  "currency": "EUR",
  "lines": [
    { "kind": "charge", "description": "Fibre 1 Gbit", "quantity": 1, "unitPrice": 39.95, "amount": 39.95 },
    { "kind": "discount", "description": "TV bundle", "quantity": 1, "unitPrice": 30.0, "amount": 24.0,
      "discountPercent": 20, "promoCode": "AUTUMN26" }
  ],
  "subtotal": 63.95,
  "dueInDays": 14,
  "notes": "Thanks for being with us"
}
```

| Field | Rules |
| --- | --- |
| `statementId`, `accountId`, `currency` | strings |
| `period` | `start` and `end` as ISO dates |
| `issuedAt` | ISO 8601 in UTC with a trailing `Z`, whatever offset the statement was created with |
| `lines` | in statement order. Every line has `kind` (`"charge"` or `"discount"`), `description`, `quantity`, `unitPrice` and `amount`. Discount lines also have `discountPercent`, and `promoCode` when the line has one |
| `subtotal` | sum of the line amounts |
| `dueInDays` | payment terms as a whole number of days |
| `notes` | only present when the statement has notes |

- Money (`unitPrice`, `amount`, `subtotal`) is always a JSON **number** (`39.95`, `24`, `0.5`), never a string.
- Keys that have no value are omitted, never sent as `null`.
- Internal fields (cost centers, internal notes) never appear in the document.
