# Public API JSON guidelines

These apply to every request and response body of every public endpoint. Mobile and partner SDKs
are generated from them, so deviations break clients.

1. **Property names are snake_case**: `customer_id`, `created_at`, `unit_price`. This applies to
   request bodies as well as responses.
2. **Null properties are omitted** from responses. Empty arrays and empty strings are kept.
3. **Money is an object with a string amount**:

   ```json
   { "amount": "12.50", "currency": "EUR" }
   ```

   - `currency` is the ISO 4217 code.
   - `amount` is a decimal string with exactly the currency's number of minor-unit digits:
     `"12.50"` for EUR, `"1200"` for JPY, `"1.250"` for BHD. Never a JSON number (floating point
     loses cents in JavaScript clients).
   - Requests use the same shape. An unknown currency, an amount that is not a decimal number, or
     an amount with more decimals than the currency allows is rejected with `400 Bad Request`.
4. **Timestamps** are ISO 8601 strings in UTC with a `Z` suffix: `"2026-03-01T10:15:30Z"`.
