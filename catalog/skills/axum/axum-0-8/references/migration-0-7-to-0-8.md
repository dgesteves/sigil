# axum 0.7 to 0.8

axum 0.8.0 shipped on 2025-01-01; 0.8.9 is current. The breaking changes below come from the axum
and axum-core CHANGELOGs; each was confirmed on 0.8.9 where noted. Bump `axum`, `axum-extra` and
`axum-macros` together: `axum-extra` 0.12.6 depends on `axum ^0.8.9`, `axum-macros` 0.5 goes with
axum 0.8.

## Find everything first

```sh
rg -n '"[^"]*/:[A-Za-z_]' src tests          # /:id capture syntax
rg -n '"[^"]*/\*[A-Za-z_]' src tests         # /*rest wildcard syntax
rg -n 'async_trait' src                        # extractor impls
rg -n -e 'Option<Query' -e 'Option<Path' -e 'Option<TypedHeader' -e 'Option<Json' src
rg -n -e 'extract::Host' -e 'Host(' src
rg -n -e 'tcp_nodelay' -e 'WebSocket.*\.close\(' -e 'Message::Text' -e 'Message::Binary' src
rg -n -e 'body_text()' -e 'Failed to' tests   # tests asserting rejection text
```

## Changes that fail loudly

| Change | Symptom on 0.8.9 | Fix |
| --- | --- | --- |
| Path syntax is matchit 0.8: `{id}`, `{*rest}` | `Router::route` panics: ``Path segments must not start with `:`. For capture groups, use `{capture}`. If you meant to literally match a segment starting with a colon, call `without_v07_checks` on the router.`` (same for `*`) (confirmed) | rewrite every path |
| `#[async_trait]` removed from `FromRequest`/`FromRequestParts` | lifetime-mismatch errors on the impl, or `axum::async_trait` not found | remove the attribute; write `async fn from_request_parts(parts: &mut Parts, state: &S)`. The trait requires the future to be `Send` |
| `Option<T>` extractor needs `OptionalFromRequestParts` (or `OptionalFromRequest` when it is the last argument) | trait bound errors for your extractors | implement the optional trait and decide which failures mean `None` |
| `Option<Query<T>>` no longer implemented | trait bound error | make the fields optional, or `axum_extra::extract::OptionalQuery` |
| `Option<Path<T>>` no longer swallows every error | invalid values reject instead of giving `None` | use `axum_extra::extract::OptionalPath` or two routes |
| Handlers and services must be `Sync` | trait bound errors mentioning `Sync` | no `Cell`/`RefCell` in captured state; `Arc<Mutex<..>>` |
| `Host` moved | not found | `axum_extra::extract::Host` |
| `Path` tuple length must match the captures | 500 `Wrong number of path arguments for Path. Expected 2 but got 1` (confirmed) | match tuple length, or use a struct |
| `WebSocket::close` removed | method not found | `socket.send(Message::Close(Some(CloseFrame { .. })))` |
| `ws::Message` carries `Utf8Bytes` / `Bytes` | type errors | `Message::Text("hi".into())`, `Message::Binary(bytes)`; `text.as_str()` |
| `serve` is generic over listener and IO; `tcp_nodelay` removed | method not found | `listener.tap_io(\|tcp\| { let _ = tcp.set_nodelay(true); })` with `axum::serve::ListenerExt` |
| MSRV | 1.75 at 0.8.0, 1.78 at 0.8.5, 1.80 at 0.8.9 | |

## Changes that are silent

| Change | Effect |
| --- | --- |
| 0.8.5: `Json` rejects trailing characters after the document | `{"a":1} x` used to parse; now 400 `trailing characters` (confirmed) |
| Query/Form errors go through `serde_path_to_error` | messages now include the field path (`a: invalid digit found in string`); tests that snapshot messages change |
| Rejection `Display` includes the inner error | log lines and `to_string()` output change |
| 0.8.3: `Option<Json<T>>` and `Option<Extension<T>>` implemented | `None` only when the content type / extension is absent; malformed JSON still rejects (confirmed) |
| 0.8.4: `serve` without graceful shutdown no longer leaks a task | nothing to do |

## Also new in 0.8 (worth using)

- `Router::method_not_allowed_fallback` (also in 0.7.8): custom 405 that keeps the `Allow` header.
- `NoContent` response, `MethodFilter::CONNECT`, WebSockets over HTTP/2 via `any(ws_handler)`.
- `serve::ListenerExt::tap_io` for per-connection socket options.
- 0.8.5: `middleware::ResponseAxumBodyLayer`; `Redirect` with an invalid location is a 500 instead
  of a panic.

## Upgrade order

1. Bump `axum`, `axum-extra`, `axum-macros` in `Cargo.toml`; `cargo update -p axum`.
2. `cargo check --all-targets` and fix the compile errors above.
3. Run the tests: path panics show up as soon as a test builds the router.
4. Go through the silent table and the rejection-text greps; update tests that assert message text.
5. Don't stop at a green build: section 3 of the skill lists behaviours that never fail a build.
