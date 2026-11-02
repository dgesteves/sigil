# reports-api

CSV exports of account reports (orders, invoices, payouts) for the customer dashboard and the mobile
app. axum 0.8 on tokio. An export runs a query against the reporting warehouse, writes the file to
object storage and returns a signed download URL. Large accounts take minutes.

## Commands

```sh
cargo test          # tests in tests/
cargo run           # serves on 127.0.0.1:3000 with a simulated warehouse
```

The build is offline: crates are vendored into `vendor/` when the environment is set up, so stick to
the dependencies (and features) already in `Cargo.toml`.

## API

`POST /v1/accounts/{account_id}/exports` with `{"report": "orders" | "invoices" | "payouts",
"month": "YYYY-MM"}`:

| Outcome | Status | Body |
| --- | --- | --- |
| done | 200 | `{"report", "rows", "download_url"}` |
| unknown report | 422 | `{"error": "unknown_report"}` |
| warehouse or storage failure | 502 | `{"error": "export_failed"}` |
| took longer than `REQUEST_TIMEOUT` (55 s) | 504 | empty |

Requests go through the API gateway, which gives up after 60 s; the mobile app gives up after 20 s.

## Layout

- `src/lib.rs`: `AppState`, `REQUEST_TIMEOUT` and `app(state) -> Router`. Tests build the app through
  `app()` with their own `Exporter`.
- `src/exporter.rs`: the `Exporter` trait and the warehouse implementation.
- `src/routes.rs`: handlers.
