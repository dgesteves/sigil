# Errors and rejections

## What axum 0.8.9 sends by default

Measured with `tower::ServiceExt::oneshot` against axum 0.8.9. Every body below is
`text/plain; charset=utf-8` unless it says "empty".

| Request | Extractor | Status | Body |
| --- | --- | --- | --- |
| no `Content-Type` | `Json<T>` | 415 | ``Expected request with `Content-Type: application/json` `` |
| `Content-Type: text/plain` | `Json<T>` | 415 | same |
| `application/json; charset=utf-8` | `Json<T>` | accepted | |
| `application/vnd.api+json` | `Json<T>` | accepted (any `+json` suffix) | |
| `{"name":` | `Json<T>` | 400 | `Failed to parse the request body as JSON: name: EOF while parsing a value at line 1 column 8` |
| `{"name":"a","qty":1} x` | `Json<T>` | 400 | `... trailing characters at line 1 column 22` |
| empty body, JSON content type | `Json<T>` | 400 | `... EOF while parsing a value at line 1 column 0` |
| `{"name":"a"}` | `Json<Item>` with `qty: u32` | 422 | ``Failed to deserialize the JSON body into the target type: missing field `qty` at line 1 column 12`` |
| `{"name":"a","qty":-1}` | same | 422 | ``... qty: invalid value: integer `-1`, expected u32 at line 1 column 20`` |
| over the body limit | `Json`, `Bytes`, `String`, `Form` | 413 | `Failed to buffer the request body: length limit exceeded` |
| over a `RequestBodyLimitLayer` with `Content-Length` | any | 413 | `length limit exceeded` |
| `/items/abc` | `Path<u64>` | 400 | ``Invalid URL: Cannot parse `abc` to a `u64` `` |
| `/t/1` on route `/t/{a}` | `Path<(u32, u32)>` | 500 | ``Wrong number of path arguments for `Path`. Expected 2 but got 1`` |
| `?a=x` | `Query<HashMap<String, u32>>` | 400 | `Failed to deserialize query string: a: invalid digit found in string` |
| `?tag=a&tag=b` or `?tag=a` | `Query<S>` with `tag: Vec<String>` | 400 | `... tag: invalid type: string "a", expected a sequence` |
| `?tag=a&tag=b` | `Query<Vec<(String, String)>>` | accepted | `[("tag","a"),("tag","b")]` |
| layer not installed | `Extension<u32>` | 500 | ``Missing request extension: Extension of type `u32` was not found. Perhaps you forgot to add it? ...`` |
| unmatched path | | 404 | empty |
| unmatched method | | 405 | empty, `Allow: GET,HEAD` (for a `get` route) |
| handler panics, no `CatchPanicLayer` | | none | connection closed without a response; the server keeps serving |
| handler panics, `CatchPanicLayer::new()` | | 500 | `Service panicked` |

The 400/422 split for JSON is useful to clients (syntax vs shape). Keep it when you wrap
rejections: use `rejection.status()`, or match the variants.

| `JsonRejection` variant | Status |
| --- | --- |
| `JsonDataError` | 422 |
| `JsonSyntaxError` | 400 |
| `MissingJsonContentType` | 415 |
| `BytesRejection` | 413 when the body limit was hit (check `.status()`), otherwise 400 |

All rejection enums are `#[non_exhaustive]`. Every rejection has `.status()` and `.body_text()`;
the body text describes the client's input (field names, positions), never server internals, so it
is safe to return as a message.

## Patterns for routing rejections through your error type

**1. Derived wrapper extractors** (needs `axum` feature `macros`). The wrapper delegates to the
real extractor and converts its rejection with `From`:

```rust
#[derive(axum::extract::FromRequest)]
#[from_request(via(axum::Json), rejection(HttpError))]
pub struct Payload<T>(pub T);

#[derive(axum::extract::FromRequestParts)]
#[from_request(via(axum::extract::Query), rejection(HttpError))]
pub struct Params<T>(pub T);

// HttpError needs From<JsonRejection> and From<QueryRejection>.
```

Return `axum::Json` for successful bodies; the wrapper is only for input. To return `Payload` as a
response as well, implement `IntoResponse` for it by delegating to `axum::Json(self.0)`.

**2. `Result` arguments** (no extra features):

```rust
async fn create(body: Result<Json<NewBooking>, JsonRejection>) -> Result<Json<Booking>, HttpError> {
    let Json(body) = body?; // From<JsonRejection> for HttpError
    // ...
}
```

Works for every extractor whose rejection type is public (`QueryRejection`, `PathRejection`,
`FormRejection`, `ExtensionRejection`). Easy to forget on one handler; the wrapper type is harder to
forget.

**3. `axum_extra::extract::WithRejection<E, R>`** (feature `with-rejection`):
`WithRejection(Json(body), _): WithRejection<Json<NewBooking>, HttpError>`.

**4. Fallbacks.** `Router::fallback(handler)` for unmatched paths and
`Router::method_not_allowed_fallback(handler)` for unmatched methods; axum keeps the `Allow`
header on the 405 (measured). Set them on the outermost router, after `merge`/`nest`.

**5. Response mapping middleware** (`axum::middleware::map_response`) can turn the empty 404/405
bodies into JSON. Don't use it to recover rejection kinds from status codes: a JSON syntax error,
a bad query string and an invalid path are all 400.

## The internal-error rule

- A 500's body is a fixed message (`internal server error`) plus, at most, a request or trace id.
- Log the error where it is converted, with its source chain: `tracing::error!(error =
  format!("{err:#}"), ..)` for `anyhow`, `error = ?err` for `thiserror` types with `#[source]`.
- `#[error(transparent)]` and `#[error("...: {0}")]` make `to_string()` include the inner error.
  That is right for logs and wrong for responses. Map the variant to a generic message instead of
  calling `to_string()` in `into_response`.
- `thiserror` 2 (current 2.0.21) and `anyhow` (1.0.104): use `thiserror` for errors callers match
  on (variants map to statuses), `anyhow` inside handlers or adapters for "something failed" with
  context. A single `Internal(#[from] anyhow::Error)` variant lets `?` work on any error in a
  handler while still forcing an explicit status mapping for the variants that matter.
- Don't add `Debug` output of request bodies to error logs when they can carry secrets.

## Panics

Without `CatchPanicLayer` a panicking handler gives the client a closed connection (measured), which
proxies report as 502. Install `tower_http::catch_panic::CatchPanicLayer::custom(handler)` (feature
`catch-panic`) where `handler: Fn(Box<dyn Any + Send>) -> Response` returns your JSON 500, and keep
the panic payload out of the body.
