# Sources

Checked on 2026-11-01. Versions are the latest stable releases on crates.io that day:
axum 0.8.9 (2026-04-14), axum-core 0.5.6, axum-macros 0.5.1, axum-extra 0.12.6, tokio 1.54.1
(2026-10-21), tokio-util 0.7.20, hyper 1.12.0, hyper-util 0.1.21, tower 0.5.3, tower-http 0.7.1
(2026-08-31), http-body-util 0.1.5, thiserror 2.0.21, anyhow 1.0.104, serde 1.0.229,
serde_json 1.0.154, matchit 0.8.4 (pinned by axum). Rust stable 1.99.1 (2026-10-13), Docker image
`rust:1.99.1-slim-bookworm`.

## Documentation and changelogs

- axum CHANGELOG (0.8.0 to 0.8.9, plus the unreleased section on `main`):
  https://github.com/tokio-rs/axum/blob/main/axum/CHANGELOG.md
- axum-core CHANGELOG (RPITIT extractors, `OptionalFromRequest(Parts)`, rejection `Display`):
  https://github.com/tokio-rs/axum/blob/main/axum-core/CHANGELOG.md
- axum 0.8.0 announcement: https://tokio.rs/blog/2025-01-01-announcing-axum-0-8-0
- axum docs, current: https://docs.rs/axum/latest/axum/ (routing, `Router::layer` vs
  `route_layer`, `fallback`, `method_not_allowed_fallback`, `extract::DefaultBodyLimit`,
  `extract::rejection`, error handling, `serve` and `with_graceful_shutdown`, middleware ordering)
- axum-macros `FromRequest`/`FromRequestParts` derive (`via`, `rejection`):
  https://docs.rs/axum-macros/latest/axum_macros/derive.FromRequest.html
- axum-extra extractors (`Host`, `Query`, `OptionalQuery`, `OptionalPath`, `WithRejection`) and
  feature flags: https://docs.rs/axum-extra/latest/axum_extra/ (exports read from the 0.12.6 crate)
- axum examples: `graceful-shutdown`, `anyhow-error-response`, `customize-extractor-error`:
  https://github.com/tokio-rs/axum/tree/main/examples
- tower-http CHANGELOG (0.6.7 `TimeoutLayer::with_status_code` and the `new` deprecation; 0.7.0
  `CsrfLayer`, `RequestBodyDeadlineLayer`, breaking changes):
  https://github.com/tower-rs/tower-http/blob/main/tower-http/CHANGELOG.md
- tower-http docs: `limit::RequestBodyLimitLayer`, `timeout`, `catch_panic`:
  https://docs.rs/tower-http/latest/tower_http/
- tokio docs: `select!` cancellation safety, `sync::Semaphore::try_acquire_owned`,
  `task::JoinSet` (aborts on drop), `JoinHandle` (detaches on drop), `spawn_blocking` (not
  abortable), `signal::unix`, `time::pause` / `start_paused`: https://docs.rs/tokio/latest/tokio/
- tokio-util: `sync::CancellationToken` (`cancelled`, `child_token`, `run_until_cancelled`),
  `task::TaskTracker` (feature `rt`): https://docs.rs/tokio-util/latest/tokio_util/ (read from the
  0.7.20 crate)
- Kubernetes pod termination and `terminationGracePeriodSeconds` (default 30 s):
  https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/#pod-termination
- Docker `--network none` (loopback only): https://docs.docker.com/engine/network/drivers/none/

## Read from the crate sources (vendored with `cargo vendor`)

- `axum-core-0.5.6/src/ext_traits/request.rs`: `DEFAULT_LIMIT: usize = 2_097_152`.
- `axum-core-0.5.6/src/extract/rejection.rs`: `LengthLimitError` is 413, `UnknownBodyError` 400.
- `axum-0.8.9/src/extract/rejection.rs`: `JsonRejection` variants; `MissingExtension` 500.
- `axum-0.8.9/src/extract/path/mod.rs`: `WrongNumberOfParameters` and `UnsupportedType` are 500,
  parse errors 400.
- `axum-0.8.9/src/json.rs`: JSON content type is `application/json` or any `+json` suffix.
- `axum-0.8.9/src/serve/listener.rs`: `ListenerExt::tap_io(FnMut(&mut Io))`.
- `axum-core-0.5.6/src/extract/option.rs`: `OptionalFromRequestParts` signature.

## Behaviour reproduced by running it

In `rust:1.99.1-slim-bookworm` against the versions above:

- `/items/:id` and `/files/*rest` panic when the route is added, with the messages quoted in the
  skill.
- Every row of the rejection table in [errors-and-rejections.md](errors-and-rejections.md),
  including `Query<Vec<String>>` failing for one or two values and `Query<Vec<(String, String)>>`
  working; 404/405 empty bodies; `Allow: GET,HEAD`; `method_not_allowed_fallback` keeping `Allow`.
- Every row of the body-limit table in
  [limits-timeouts-cancellation.md](limits-timeouts-cancellation.md), including chunked bodies and
  raw `Body`/`Request` ignoring `DefaultBodyLimit`.
- `.layer(auth)` followed by `.route("/after", ..)`: `/after` answered 200 without credentials;
  an unknown path answered 401 with `layer` and 404 with `route_layer`.
- `Option<Json<T>>`: no content type gives `None`; malformed JSON is a 400.
- A panicking handler without `CatchPanicLayer`: the client read 0 bytes before the connection
  closed, and the server kept serving; with `CatchPanicLayer::new()`: 500 `Service panicked`;
  with `CatchPanicLayer::custom`: the custom JSON 500.
- Handler futures dropped (a `Drop` guard ran, code after `.await` did not) on TCP close, on a
  client half-close, on `TimeoutLayer` (504, paused clock) and on `JoinHandle::abort()`.
- Graceful shutdown: in-flight request completed, idle keep-alive connection closed, new
  connections refused, a never-finishing handler kept the server running past 2 s.
- Every code block in SKILL.md compiled (with `axum` feature `macros`, `tower-http` features
  `catch-panic, limit, timeout, trace`, `tokio-util` feature `rt`) and the limiter, error type,
  optional extractor and shutdown sequence behaved as described.
