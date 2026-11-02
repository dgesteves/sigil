# Testing axum 0.8 services

Dev-dependencies used below (all current as of November 2026):

```toml
[dev-dependencies]
tower = { version = "0.5.3", features = ["util"] }             # ServiceExt::oneshot
http-body-util = { version = "0.1.5", features = ["channel"] } # collect bodies, chunked bodies
tokio = { version = "1.54.1", features = ["test-util"] }        # start_paused
```

Adding a feature can change `Cargo.lock` (the `channel` feature pulls `tokio` into
`http-body-util`'s dependency list), so offline `--locked` builds need the feature enabled before
the lockfile is generated.

## Requests in-process

```rust
use axum::{Router, body::Body, http::{Request, StatusCode, header}};
use http_body_util::BodyExt;
use tower::ServiceExt;

async fn call(app: &Router, req: Request<Body>) -> (StatusCode, serde_json::Value) {
    let res = app.clone().oneshot(req).await.unwrap(); // Router: Clone, cheap
    let status = res.status();
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    (status, serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null))
}

fn json(method: &str, uri: &str, body: serde_json::Value) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(uri)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body.to_string()))
        .unwrap()
}
```

Test the error paths, not only the happy path: missing content type (415), truncated JSON (400),
wrong field types (422), oversized bodies (413), unknown paths (404) and wrong methods (405 with
`Allow`), plus every status your own error type maps.

## Bodies with and without Content-Length

`Body::from(Vec<u8>)` has an exact size. Set `Content-Length` yourself when the code under test
reads the header (`RequestBodyLimitLayer` does). For a chunked upload, stream frames:

```rust
use axum::body::Bytes;
use http_body_util::channel::Channel;

fn chunked(uri: &str, data: Vec<u8>) -> Request<Body> {
    let (mut tx, body) = Channel::<Bytes, std::convert::Infallible>::new(8);
    tokio::spawn(async move {
        for part in data.chunks(64 * 1024) {
            if tx.send_data(Bytes::copy_from_slice(part)).await.is_err() {
                break; // the server stopped reading (for example after a 413)
            }
        }
    });
    Request::put(uri).header(header::CONTENT_TYPE, "image/png").body(Body::new(body)).unwrap()
}
```

## Blocked fakes, disconnects and timeouts

To test concurrency limits and cancellation, give the handler a fake dependency that blocks until
the test releases it and records when its future is dropped:

```rust
struct DropFlag(Arc<AtomicUsize>, bool);
impl Drop for DropFlag {
    fn drop(&mut self) { if !self.1 { self.0.fetch_add(1, Ordering::SeqCst); } } // cancelled
}
// in the fake: let mut p = DropFlag(cancelled.clone(), false); let out = release_rx.await; p.1 = true;
```

- **Concurrent requests**: `tokio::spawn(app.clone().oneshot(req))` for each; wait until the fake
  reports they started (a `tokio::sync::watch` channel and `wait_for` works well), then assert.
- **Client disconnect**: `handle.abort()` on the spawned request drops the handler future exactly
  like hyper does when the connection closes. Then assert the flag saw the drop and the resource
  was released.
- **Timeouts**: `#[tokio::test(start_paused = true)]`. When every task is waiting, the clock jumps
  to the next timer, so a 30 s `TimeoutLayer` fires instantly. Don't mix paused time with real
  sleeps in the same test.
- **Races**: `#[tokio::test(flavor = "multi_thread", worker_threads = 4)]` and a burst of requests
  for the same key; assert exactly the allowed number started.
- Wrap waits in `tokio::time::timeout` so a deadlocked implementation fails instead of hanging.

## Real sockets

For shutdown and disconnect behaviour end to end, bind `tokio::net::TcpListener::bind("127.0.0.1:0")`,
spawn `axum::serve(listener, app)`, and drive it with a raw `tokio::net::TcpStream`
(`GET /x HTTP/1.1\r\nhost: t\r\n\r\n`). Loopback works inside a container started with
`--network none` (Docker keeps the loopback device).
