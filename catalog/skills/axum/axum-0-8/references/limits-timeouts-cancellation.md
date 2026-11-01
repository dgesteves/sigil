# Limits, timeouts, cancellation and shutdown

All results measured on axum 0.8.9, hyper 1.12.0, tower-http 0.7.1, tokio 1.54.1.

## Body limits

Two independent mechanisms:

- **`axum::extract::DefaultBodyLimit`**: a layer that sets the limit the buffering extractors
  (`Bytes`, `String`, `Json`, `Form`, `Multipart`) apply while reading. Default 2,097,152 bytes.
  `DefaultBodyLimit::max(n)` or `DefaultBodyLimit::disable()`.
- **`tower_http::limit::RequestBodyLimitLayer::new(n)`**: rejects a too-large `Content-Length` with
  413 before the handler runs, and wraps the body so reading past `n` fails. Applies to every
  extractor, raw `Body` included.

The effective limit for a buffering extractor is the smaller of the two. Measured with an 8 MiB
`Bytes` upload:

| Setup | 8 MiB | Notes |
| --- | --- | --- |
| `RequestBodyLimitLayer::new(12 MiB)` only | **413** | the 2 MB extractor default still applies |
| route `post(h).layer(DefaultBodyLimit::max(12 MiB))` inside router `.layer(DefaultBodyLimit::max(32 KiB))` | 200 | innermost wins; a 40 KiB JSON body on another route: 413 |
| route `DefaultBodyLimit::max(32 KiB)` inside router `DefaultBodyLimit::max(12 MiB)` | 200 on the upload route | the JSON route with 32 KiB rejects 40 KiB: innermost wins both ways |
| `.route_layer(DefaultBodyLimit::max(12 MiB))` | 200 | |
| `DefaultBodyLimit::disable()` + `RequestBodyLimitLayer::new(12 MiB)` | 200; 13 MiB: 413 | the tower-http layer is now the only limit |

Chunked bodies (no `Content-Length`): with `DefaultBodyLimit::max(3 MiB)`, 2.5 MiB passed and
4 MiB got 413; with `disable()` + `RequestBodyLimitLayer::new(3 MiB)`, the same.

Raw extractors: with `DefaultBodyLimit::max(1 KiB)` installed, a 4 KiB body was accepted by `Body`
and by `Request`, and rejected (413) by `String`. Raw bodies need `RequestBodyLimitLayer` or
`axum::body::to_bytes(body, max)`.

Where the layer goes matters:

- `Router::layer` wraps the routes the router has at that point. Routes added or merged in later
  are not wrapped; a layer applied after the merge wraps all of them.
- A router-wide `RequestBodyLimitLayer::new(64 KiB)` caps an upload route merged into that router,
  whatever the route sets inside. Split the routers (`json_api.merge(uploads)` with each limit on
  its own router) or put the limits on the `MethodRouter`s.

Multipart uploads use the same `DefaultBodyLimit`; set it on the multipart route.

## Timeouts

- `tower_http::timeout::TimeoutLayer::with_status_code(status, duration)`: when the duration
  passes, it drops the inner future and returns an empty response with `status`. `TimeoutLayer::new`
  has been deprecated since tower-http 0.6.7 (it always used 408).
- `tower::timeout::TimeoutLayer` returns an error instead of a response; axum then needs
  `HandleErrorLayer` in front of it. The tower-http one is simpler for HTTP.
- Request bodies from slow clients: `tower_http::timeout::RequestBodyTimeoutLayer` resets on every
  frame (an idle timeout); tower-http 0.7 adds `RequestBodyDeadlineLayer` and
  `ResponseBodyDeadlineLayer`, which cap the whole transfer.
- Slow request headers: the CHANGELOG's unreleased section lists "`axum::serve` now applies
  hyper's default `header_read_timeout`" as an upcoming breaking change, so `axum::serve` 0.8.9
  does not. Cut off slow clients at the proxy or load balancer.

## Cancellation

The handler future is dropped, at whatever `.await` it is suspended on, when:

| Event | Measured |
| --- | --- |
| the client closes the TCP connection while the handler runs | dropped; a `Drop` guard in the handler ran, code after the `.await` did not |
| the client half-closes (shuts down its write side) | dropped as well |
| `TimeoutLayer` fires | dropped (504 returned; guard ran) |
| `JoinHandle::abort()` on a test that spawned `oneshot` | dropped; same as a disconnect |
| `tokio::select!` picks another branch | the other branches are dropped (by definition) |

Consequences:

- Any cleanup written after an `.await` is skipped on those paths. Put it in `Drop`.
- `?` early returns skip it too; a guard handles both.
- A `std::sync::Mutex` guard can't be held across `.await` in a handler (the future would not be
  `Send`), which is good: it forces short critical sections. A `tokio::sync::Mutex` guard held
  across the slow call serializes every request that needs it.
- `spawn_blocking` work is not cancelled when the handler is dropped; it runs to completion.
- If work must finish regardless of the client (payments, audit), `tokio::spawn` it and await the
  `JoinHandle`. Dropping a `JoinHandle` detaches the task; it does not cancel it.
- If work should stop when the client leaves, keep it inside the handler future, and don't spawn it.

Per-key concurrency limits:

- `HashMap<Key, Arc<tokio::sync::Semaphore>>` behind a `std::sync::Mutex`; clone the `Arc` out,
  release the map lock, then `semaphore.try_acquire_owned()`: `Err(TryAcquireError::NoPermits)`
  means "busy" (429). The `OwnedSemaphorePermit` is the guard. Remove idle entries from time to
  time (`Arc::strong_count(&sem) == 1` and all permits available).
- Or a counter map with a guard whose `Drop` decrements and removes zero entries (see the skill).
- Check and increment under one lock acquisition, or a burst of concurrent requests overshoots.
- `tower::limit::ConcurrencyLimitLayer` is one global limit that **waits** for a slot; it doesn't
  answer 429 and isn't per key.

## Graceful shutdown

Measured with `axum::serve(listener, app).with_graceful_shutdown(signal)`:

- after the signal, an in-flight request (500 ms handler) completed and its client got the body;
- an idle keep-alive connection was closed by the server (read returned 0);
- new connections were refused once the server future returned;
- a handler that never finishes kept the server future pending (not done after 2 s): there is no
  built-in deadline.

The `serve` future's output is `io::Result<()>` on 0.8.9 (the unreleased main branch changes this).

Shutdown checklist:

1. Listen for SIGTERM and Ctrl+C (`tokio::signal::unix::signal(SignalKind::terminate())`).
2. Cancel a `tokio_util::sync::CancellationToken` from the shutdown future so background loops
   (`tokio::select! { _ = token.cancelled() => break, msg = rx.recv() => .. }`) stop taking work.
3. Await the server under a deadline shorter than the orchestrator's grace period (Kubernetes:
   `terminationGracePeriodSeconds`, default 30 s).
4. `tracker.close(); tracker.wait().await` on a `tokio_util::task::TaskTracker` (tokio-util
   feature `rt`) to let background tasks finish their current item.
5. Return from `main` so the runtime drops; anything still running is cancelled at its next
   `.await`.

Streaming responses (SSE, WebSocket, long downloads) hold shutdown open. Give their streams the
token (`token.cancelled()` ends the stream) so they finish promptly.
