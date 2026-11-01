//! Hidden verifier: photo uploads up to 15 MiB (sized or chunked) are stored, bigger ones get 413,
//! content type, slot and listing are checked, and JSON routes keep their 64 KiB limit.

use axum::{
    Router,
    body::{Body, Bytes},
    http::{Request, StatusCode, header},
};
use http_body_util::{BodyExt, channel::Channel};
use listings_api::{AppState, app};
use serde_json::{Value, json};
use tower::ServiceExt;

const MIB: usize = 1024 * 1024;
const LIMIT: usize = 15 * MIB;

async fn send(app: &Router, req: Request<Body>) -> (StatusCode, Value) {
    let res = app.clone().oneshot(req).await.unwrap();
    let status = res.status();
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    (status, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
}

async fn setup() -> (AppState, Router, u64) {
    let state = AppState::default();
    let app = app(state.clone());
    let (status, listing) = send(
        &app,
        Request::post("/v1/listings")
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(
                json!({"title": "Loft by the river", "city": "Lisbon", "price_eur": 540000})
                    .to_string(),
            ))
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    (state, app, listing["id"].as_u64().unwrap())
}

fn image(len: usize, seed: u8) -> Vec<u8> {
    (0..len).map(|i| (i as u8).wrapping_mul(31).wrapping_add(seed)).collect()
}

/// A body with an exact Content-Length, as most clients send.
fn sized(uri: &str, content_type: &str, data: Vec<u8>) -> Request<Body> {
    Request::put(uri)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CONTENT_LENGTH, data.len())
        .body(Body::from(data))
        .unwrap()
}

/// A streamed body with no Content-Length (chunked transfer encoding on the wire).
fn chunked(uri: &str, content_type: &str, data: Vec<u8>) -> Request<Body> {
    let (mut tx, body) = Channel::<Bytes, std::convert::Infallible>::new(8);
    tokio::spawn(async move {
        let data = Bytes::from(data);
        let mut at = 0;
        while at < data.len() {
            let end = (at + 64 * 1024).min(data.len());
            if tx.send_data(data.slice(at..end)).await.is_err() {
                break; // the server stopped reading
            }
            at = end;
        }
    });
    Request::put(uri)
        .header(header::CONTENT_TYPE, content_type)
        .body(Body::new(body))
        .unwrap()
}

#[tokio::test]
async fn stores_a_typical_phone_photo() {
    let (state, app, id) = setup().await;
    let data = image(5 * MIB + 123, 7);
    let (status, body) = send(&app, sized(&format!("/v1/listings/{id}/photos/1"), "image/jpeg", data.clone())).await;
    assert_eq!(status, StatusCode::CREATED, "a 5 MiB JPEG must be accepted: {body}");
    assert_eq!(
        body,
        json!({"listing_id": id, "slot": 1, "content_type": "image/jpeg", "size": data.len()})
    );
    let stored = state.photo(id, 1).expect("photo stored");
    assert_eq!(stored.content_type, "image/jpeg");
    assert!(stored.data == data, "stored bytes differ from the upload");
}

#[tokio::test]
async fn stores_a_large_chunked_upload() {
    let (state, app, id) = setup().await;
    let data = image(12 * MIB, 3);
    let (status, body) = send(&app, chunked(&format!("/v1/listings/{id}/photos/4"), "image/png", data.clone())).await;
    assert_eq!(status, StatusCode::CREATED, "a 12 MiB chunked PNG must be accepted: {body}");
    assert_eq!(body["size"], data.len());
    assert!(state.photo(id, 4).unwrap().data == data);
}

#[tokio::test]
async fn accepts_exactly_the_limit() {
    let (state, app, id) = setup().await;
    let (status, _) = send(&app, sized(&format!("/v1/listings/{id}/photos/20"), "image/webp", image(LIMIT, 1))).await;
    assert_eq!(status, StatusCode::CREATED, "exactly 15 MiB must be accepted");
    assert_eq!(state.photo(id, 20).unwrap().data.len(), LIMIT);
}

#[tokio::test]
async fn rejects_more_than_the_limit() {
    let (state, app, id) = setup().await;
    let (status, _) = send(&app, sized(&format!("/v1/listings/{id}/photos/2"), "image/jpeg", image(LIMIT + 1, 2))).await;
    assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE, "15 MiB + 1 byte with Content-Length");
    let (status, _) = send(&app, chunked(&format!("/v1/listings/{id}/photos/2"), "image/jpeg", image(LIMIT + MIB, 2))).await;
    assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE, "16 MiB chunked upload");
    assert!(state.photo(id, 2).is_none(), "nothing may be stored for a rejected upload");
}

#[tokio::test]
async fn replaces_a_slot_and_lists_slots() {
    let (state, app, id) = setup().await;
    for (slot, seed) in [(3u8, 1u8), (1, 2), (3, 9)] {
        let (status, _) = send(&app, sized(&format!("/v1/listings/{id}/photos/{slot}"), "image/jpeg", image(3 * MIB, seed))).await;
        assert_eq!(status, StatusCode::CREATED, "3 MiB upload to slot {slot}");
    }
    assert!(state.photo(id, 3).unwrap().data == image(3 * MIB, 9), "slot 3 holds the newest photo");
    let (status, listing) = send(&app, Request::get(format!("/v1/listings/{id}")).body(Body::empty()).unwrap()).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(listing["photos"], json!([1, 3]));
}

#[tokio::test]
async fn rejects_non_image_content_types() {
    let (state, app, id) = setup().await;
    for content_type in ["text/plain", "application/octet-stream", "image/gif"] {
        let (status, _) = send(&app, sized(&format!("/v1/listings/{id}/photos/1"), content_type, image(1024, 0))).await;
        assert_eq!(status, StatusCode::UNSUPPORTED_MEDIA_TYPE, "{content_type}");
    }
    let req = Request::put(format!("/v1/listings/{id}/photos/1")).body(Body::from(image(1024, 0))).unwrap();
    let (status, _) = send(&app, req).await;
    assert_eq!(status, StatusCode::UNSUPPORTED_MEDIA_TYPE, "missing content type");
    assert!(state.photo(id, 1).is_none());
}

#[tokio::test]
async fn checks_listing_and_slot() {
    let (_state, app, id) = setup().await;
    let (status, _) = send(&app, sized(&format!("/v1/listings/{}/photos/1", id + 100), "image/jpeg", image(2048, 0))).await;
    assert_eq!(status, StatusCode::NOT_FOUND, "unknown listing");
    for slot in ["0", "21", "300", "first"] {
        let (status, _) = send(&app, sized(&format!("/v1/listings/{id}/photos/{slot}"), "image/jpeg", image(2048, 0))).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "slot {slot}");
    }
}

#[tokio::test]
async fn json_routes_keep_the_64_kib_limit() {
    let (_state, app, id) = setup().await;
    let big = json!({"title": "t".repeat(100 * 1024), "city": "Lisbon", "price_eur": 1}).to_string();
    let (status, _) = send(&app, Request::post("/v1/listings").header(header::CONTENT_TYPE, "application/json").body(Body::from(big)).unwrap()).await;
    assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE, "100 KiB POST /v1/listings");
    let big = json!({"title": "t".repeat(70 * 1024)}).to_string();
    let (status, _) = send(&app, Request::patch(format!("/v1/listings/{id}")).header(header::CONTENT_TYPE, "application/json").body(Body::from(big)).unwrap()).await;
    assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE, "70 KiB PATCH");
    // A chunked JSON body is limited too.
    let big = json!({"title": "t".repeat(200 * 1024)}).to_string().into_bytes();
    let mut req = chunked(&format!("/v1/listings/{id}"), "application/json", big);
    *req.method_mut() = axum::http::Method::PATCH;
    let (status, _) = send(&app, req).await;
    assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE, "200 KiB chunked PATCH");
    let ok = json!({"title": "t".repeat(10 * 1024)}).to_string();
    let (status, _) = send(&app, Request::patch(format!("/v1/listings/{id}")).header(header::CONTENT_TYPE, "application/json").body(Body::from(ok)).unwrap()).await;
    assert_eq!(status, StatusCode::OK, "10 KiB PATCH is fine");
}
