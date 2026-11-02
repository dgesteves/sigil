//! Hidden verifier: every error response is `{"error":{"code","message"}}` JSON with the status and
//! code the request asked for, store failures never reach the client, and successes are unchanged.

use anyhow::anyhow;
use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode, header},
};
use http_body_util::BodyExt;
use inventory_api::{
    AppState, InventoryStore, MemoryStore, NewProduct, Product, StoreError, app,
};
use serde_json::{Value, json};
use tower::ServiceExt;

const SECRET_BITS: [&str; 4] = ["10.40.2.7", "inventory_rw", "password", "FATAL"];

struct BrokenStore;

fn outage() -> StoreError {
    StoreError::Backend(anyhow!(
        "error connecting to 10.40.2.7:5432: FATAL: password authentication failed for user \"inventory_rw\""
    ))
}

impl InventoryStore for BrokenStore {
    fn create(&self, _: NewProduct) -> Result<Product, StoreError> {
        Err(outage())
    }
    fn get(&self, _: &str) -> Result<Option<Product>, StoreError> {
        Err(outage())
    }
    fn list(&self, _: usize, _: usize) -> Result<Vec<Product>, StoreError> {
        Err(outage())
    }
    fn adjust_stock(&self, _: &str, _: i64) -> Result<Product, StoreError> {
        Err(outage())
    }
}

struct Reply {
    status: StatusCode,
    content_type: String,
    allow: Option<String>,
    raw: String,
    json: Option<Value>,
}

async fn send(app: &Router, req: Request<Body>) -> Reply {
    let res = app.clone().oneshot(req).await.unwrap();
    let status = res.status();
    let content_type = res
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let allow = res
        .headers()
        .get(header::ALLOW)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    let raw = String::from_utf8_lossy(&bytes).to_string();
    let json = serde_json::from_slice(&bytes).ok();
    Reply {
        status,
        content_type,
        allow,
        raw,
        json,
    }
}

/// Asserts the status, the JSON content type and the envelope, and returns the message.
fn assert_error(reply: &Reply, status: StatusCode, code: &str, what: &str) -> String {
    assert_eq!(reply.status, status, "{what}: status (body: {})", reply.raw);
    assert!(
        reply.content_type.starts_with("application/json"),
        "{what}: expected an application/json error, got content-type {:?} and body {:?}",
        reply.content_type,
        reply.raw
    );
    let json = reply
        .json
        .as_ref()
        .unwrap_or_else(|| panic!("{what}: body is not JSON: {:?}", reply.raw));
    assert_eq!(
        json["error"]["code"], code,
        "{what}: error code in {json}"
    );
    let message = json["error"]["message"]
        .as_str()
        .unwrap_or_else(|| panic!("{what}: error.message must be a string in {json}"));
    assert!(!message.trim().is_empty(), "{what}: empty message");
    message.to_string()
}

fn json_req(method: &str, uri: &str, body: impl Into<String>) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(uri)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body.into()))
        .unwrap()
}

fn get(uri: &str) -> Request<Body> {
    Request::get(uri).body(Body::empty()).unwrap()
}

async fn seeded() -> Router {
    let app = app(AppState::new(MemoryStore::default()));
    let reply = send(
        &app,
        json_req(
            "POST",
            "/v1/products",
            json!({"sku": "GEAR-12", "name": "12-tooth gear", "price_cents": 450, "stock": 5})
                .to_string(),
        ),
    )
    .await;
    assert_eq!(reply.status, StatusCode::CREATED, "seed: {}", reply.raw);
    app
}

#[tokio::test]
async fn malformed_json_is_400() {
    let app = seeded().await;
    let r = send(&app, json_req("POST", "/v1/products", r#"{"sku": "GEAR-13", "name": "#)).await;
    assert_error(&r, StatusCode::BAD_REQUEST, "malformed_json", "truncated JSON");
    let r = send(&app, json_req("POST", "/v1/products/GEAR-12/stock-adjustments", "delta=3")).await;
    assert_error(&r, StatusCode::BAD_REQUEST, "malformed_json", "form body sent as JSON");
}

#[tokio::test]
async fn wrong_shape_is_422_invalid_body() {
    let app = seeded().await;
    let r = send(
        &app,
        json_req("POST", "/v1/products", json!({"sku": "GEAR-13", "name": "x"}).to_string()),
    )
    .await;
    assert_error(&r, StatusCode::UNPROCESSABLE_ENTITY, "invalid_body", "missing price_cents");
    let r = send(
        &app,
        json_req(
            "POST",
            "/v1/products",
            json!({"sku": "GEAR-13", "name": "x", "price_cents": "450"}).to_string(),
        ),
    )
    .await;
    assert_error(&r, StatusCode::UNPROCESSABLE_ENTITY, "invalid_body", "price_cents as a string");
    let r = send(
        &app,
        json_req("POST", "/v1/products/GEAR-12/stock-adjustments", json!({"delta": 1.5}).to_string()),
    )
    .await;
    assert_error(&r, StatusCode::UNPROCESSABLE_ENTITY, "invalid_body", "fractional delta");
}

#[tokio::test]
async fn non_json_content_type_is_415() {
    let app = seeded().await;
    let body = json!({"sku": "GEAR-13", "name": "x", "price_cents": 1}).to_string();
    let r = send(
        &app,
        Request::post("/v1/products").body(Body::from(body.clone())).unwrap(),
    )
    .await;
    assert_error(&r, StatusCode::UNSUPPORTED_MEDIA_TYPE, "unsupported_media_type", "no content-type");
    let r = send(
        &app,
        Request::post("/v1/products/GEAR-12/stock-adjustments")
            .header(header::CONTENT_TYPE, "text/plain")
            .body(Body::from(r#"{"delta": 1}"#))
            .unwrap(),
    )
    .await;
    assert_error(&r, StatusCode::UNSUPPORTED_MEDIA_TYPE, "unsupported_media_type", "text/plain");
}

#[tokio::test]
async fn oversized_body_is_413() {
    let app = seeded().await;
    let big = json!({"sku": "GEAR-13", "name": "x".repeat(20 * 1024), "price_cents": 1}).to_string();
    let r = send(&app, json_req("POST", "/v1/products", big)).await;
    assert_error(&r, StatusCode::PAYLOAD_TOO_LARGE, "payload_too_large", "20 KiB create body");
    let big = format!(r#"{{"delta": 1, "note": "{}"}}"#, "n".repeat(17 * 1024));
    let r = send(&app, json_req("POST", "/v1/products/GEAR-12/stock-adjustments", big)).await;
    assert_error(&r, StatusCode::PAYLOAD_TOO_LARGE, "payload_too_large", "17 KiB adjustment body");
}

#[tokio::test]
async fn bad_query_is_400_invalid_query() {
    let app = seeded().await;
    for uri in [
        "/v1/products?limit=ten",
        "/v1/products?offset=-1",
        "/v1/products?limit=0",
        "/v1/products?limit=101",
    ] {
        let r = send(&app, get(uri)).await;
        assert_error(&r, StatusCode::BAD_REQUEST, "invalid_query", uri);
    }
    let r = send(&app, get("/v1/products?limit=100")).await;
    assert_eq!(r.status, StatusCode::OK, "limit=100 is allowed: {}", r.raw);
}

#[tokio::test]
async fn rule_violations_are_422_and_name_the_field() {
    let app = seeded().await;
    let cases = [
        (json!({"sku": "g-1", "name": "Gear", "price_cents": 1}), "sku"),
        (json!({"sku": "GEAR-13", "name": "   ", "price_cents": 1}), "name"),
        (json!({"sku": "GEAR-13", "name": "Gear", "price_cents": 0}), "price_cents"),
        (json!({"sku": "GEAR-13", "name": "Gear", "price_cents": 5, "stock": -2}), "stock"),
    ];
    for (body, field) in cases {
        let r = send(&app, json_req("POST", "/v1/products", body.to_string())).await;
        let message = assert_error(&r, StatusCode::UNPROCESSABLE_ENTITY, "validation_failed", field);
        assert!(message.contains(field), "message {message:?} should name {field}");
    }
    let r = send(
        &app,
        json_req("POST", "/v1/products/GEAR-12/stock-adjustments", json!({"delta": 0}).to_string()),
    )
    .await;
    let message = assert_error(&r, StatusCode::UNPROCESSABLE_ENTITY, "validation_failed", "delta 0");
    assert!(message.contains("delta"), "message {message:?} should name delta");
}

#[tokio::test]
async fn not_found_and_conflicts() {
    let app = seeded().await;
    let r = send(&app, get("/v1/products/GEAR-99")).await;
    assert_error(&r, StatusCode::NOT_FOUND, "not_found", "unknown product");
    let r = send(
        &app,
        json_req("POST", "/v1/products/GEAR-99/stock-adjustments", json!({"delta": 1}).to_string()),
    )
    .await;
    assert_error(&r, StatusCode::NOT_FOUND, "not_found", "adjust unknown product");
    let r = send(
        &app,
        json_req(
            "POST",
            "/v1/products",
            json!({"sku": "GEAR-12", "name": "dupe", "price_cents": 1}).to_string(),
        ),
    )
    .await;
    assert_error(&r, StatusCode::CONFLICT, "already_exists", "duplicate sku");
    let r = send(
        &app,
        json_req("POST", "/v1/products/GEAR-12/stock-adjustments", json!({"delta": -6}).to_string()),
    )
    .await;
    assert_error(&r, StatusCode::CONFLICT, "insufficient_stock", "stock below zero");
}

#[tokio::test]
async fn unmatched_routes_and_methods() {
    let app = seeded().await;
    let r = send(&app, get("/v1/warehouses")).await;
    assert_error(&r, StatusCode::NOT_FOUND, "not_found", "unknown path");
    let r = send(&app, get("/v1/products/GEAR-12/stock")).await;
    assert_error(&r, StatusCode::NOT_FOUND, "not_found", "unknown nested path");

    let r = send(&app, Request::delete("/v1/products/GEAR-12").body(Body::empty()).unwrap()).await;
    assert_error(&r, StatusCode::METHOD_NOT_ALLOWED, "method_not_allowed", "DELETE product");
    let allow = r.allow.clone().unwrap_or_default();
    assert!(allow.contains("GET"), "405 must keep the Allow header, got {allow:?}");

    let r = send(&app, json_req("PUT", "/v1/products", "{}")).await;
    assert_error(&r, StatusCode::METHOD_NOT_ALLOWED, "method_not_allowed", "PUT collection");
    let allow = r.allow.clone().unwrap_or_default();
    assert!(
        allow.contains("GET") && allow.contains("POST"),
        "405 must keep the Allow header, got {allow:?}"
    );
}

#[tokio::test]
async fn store_failures_are_500_without_details() {
    let app = app(AppState::new(BrokenStore));
    let requests = [
        get("/v1/products"),
        get("/v1/products/GEAR-12"),
        json_req(
            "POST",
            "/v1/products",
            json!({"sku": "GEAR-13", "name": "Gear", "price_cents": 1}).to_string(),
        ),
        json_req("POST", "/v1/products/GEAR-12/stock-adjustments", json!({"delta": 2}).to_string()),
    ];
    for req in requests {
        let what = format!("{} {}", req.method(), req.uri());
        let r = send(&app, req).await;
        let message = assert_error(&r, StatusCode::INTERNAL_SERVER_ERROR, "internal", &what);
        assert_eq!(message, "internal server error", "{what}");
        for bit in SECRET_BITS {
            assert!(!r.raw.contains(bit), "{what}: response leaks {bit:?}: {}", r.raw);
        }
    }
}

#[tokio::test]
async fn successes_are_unchanged() {
    let app = seeded().await;
    let r = send(&app, get("/v1/products/GEAR-12")).await;
    assert_eq!(r.status, StatusCode::OK);
    assert_eq!(
        r.json.unwrap(),
        json!({"sku": "GEAR-12", "name": "12-tooth gear", "price_cents": 450, "stock": 5})
    );
    let r = send(
        &app,
        json_req(
            "POST",
            "/v1/products/GEAR-12/stock-adjustments",
            json!({"delta": -5}).to_string(),
        ),
    )
    .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.raw);
    assert_eq!(r.json.unwrap()["stock"], 0);
    let r = send(
        &app,
        Request::post("/v1/products")
            .header(header::CONTENT_TYPE, "application/json; charset=utf-8")
            .body(Body::from(
                json!({"sku": "GEAR-14", "name": " Gear ", "price_cents": 9}).to_string(),
            ))
            .unwrap(),
    )
    .await;
    assert_eq!(r.status, StatusCode::CREATED, "{}", r.raw);
    assert_eq!(r.json.unwrap()["stock"], 0);
    let r = send(&app, get("/v1/products")).await;
    assert_eq!(r.status, StatusCode::OK);
    assert_eq!(r.json.unwrap().as_array().unwrap().len(), 2);
}
