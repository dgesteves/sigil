# listings-api

Property listings for the agents' app. axum 0.8 on tokio. Listing data and photos are kept in
`AppState`; in production that state fronts Postgres and the object store, here it is in memory.

## Commands

```sh
cargo test          # tests in tests/
cargo run           # serves on 127.0.0.1:3000
```

The build is offline: crates are vendored into `vendor/` when the environment is set up, so stick to
the dependencies (and features) already in `Cargo.toml`.

## API

| Method and path | Body | Success |
| --- | --- | --- |
| `POST /v1/listings` | `{"title","city","price_eur"}` | 201, the listing |
| `GET /v1/listings/{id}` | | 200, the listing |
| `PATCH /v1/listings/{id}` | any of `title`, `city`, `price_eur` | 200, the listing |

A listing looks like `{"id": 1, "title": "...", "city": "...", "price_eur": 450000, "photos": [1, 3]}`;
`photos` lists the photo slots that hold an image, in ascending order.

JSON bodies are small, so the API rejects request bodies over 64 KiB with 413.

## Layout

- `src/lib.rs`: `app(state) -> Router` and the limits. Tests build the app through `app()`.
- `src/state.rs`: `AppState`, listings and photos (`put_photo`, `photo`).
- `src/routes.rs`: handlers.
