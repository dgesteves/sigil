# inventory-api

Product catalogue and stock levels for the warehouse apps. axum 0.8 on tokio; the production binary
uses a Postgres-backed store, tests and local runs use `MemoryStore`.

## Commands

```sh
cargo test          # unit and integration tests (tests/)
cargo run           # serves on 127.0.0.1:3000 with an in-memory store
```

The build is offline: crates are vendored into `vendor/` when the environment is set up, so stick to
the dependencies (and features) already in `Cargo.toml`.

## Layout

- `src/lib.rs`: `AppState` and `app(state) -> Router`. Tests build the app through `app()` with their
  own `InventoryStore` implementations, so keep that signature.
- `src/routes.rs`: handlers.
- `src/store.rs`: the `InventoryStore` trait, its errors, and `MemoryStore`. The Postgres store lives
  in the platform crate and implements the same trait; `StoreError::Backend` wraps whatever the
  driver returned, which can include hostnames, user names and SQL.

## API

| Method and path | Body | Success |
| --- | --- | --- |
| `GET /v1/products?offset=&limit=` | | 200, array of products (`limit` defaults to 20, max 100) |
| `POST /v1/products` | `{"sku","name","price_cents","stock"}` | 201, the product |
| `GET /v1/products/{sku}` | | 200, the product |
| `POST /v1/products/{sku}/stock-adjustments` | `{"delta"}` | 200, the updated product |

Rules: `sku` is 3 to 32 characters from `A-Z`, `0-9` and `-`; `name` is not blank and at most 120
characters; `price_cents` is positive; `stock` is zero or more (default 0); `delta` is not zero.
Request bodies are limited to 16 KiB.
