use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode, header},
};
use http_body_util::BodyExt;
use inventory_api::{AppState, MemoryStore, app};
use serde_json::{Value, json};
use tower::ServiceExt;

fn test_app() -> Router {
    app(AppState::new(MemoryStore::default()))
}

async fn send(app: &Router, req: Request<Body>) -> (StatusCode, Value) {
    let res = app.clone().oneshot(req).await.unwrap();
    let status = res.status();
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    let body = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes).unwrap_or(Value::String(String::from_utf8_lossy(&bytes).into()))
    };
    (status, body)
}

fn post_json(uri: &str, body: Value) -> Request<Body> {
    Request::post(uri)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body.to_string()))
        .unwrap()
}

fn get(uri: &str) -> Request<Body> {
    Request::get(uri).body(Body::empty()).unwrap()
}

#[tokio::test]
async fn creates_and_reads_a_product() {
    let app = test_app();
    let (status, body) = send(
        &app,
        post_json(
            "/v1/products",
            json!({"sku": "BOLT-M8", "name": "M8 bolt", "price_cents": 35, "stock": 400}),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(
        body,
        json!({"sku": "BOLT-M8", "name": "M8 bolt", "price_cents": 35, "stock": 400})
    );

    let (status, body) = send(&app, get("/v1/products/BOLT-M8")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["name"], "M8 bolt");
}

#[tokio::test]
async fn adjusts_stock() {
    let app = test_app();
    send(
        &app,
        post_json(
            "/v1/products",
            json!({"sku": "NUT-M8", "name": "M8 nut", "price_cents": 12, "stock": 10}),
        ),
    )
    .await;
    let (status, body) = send(
        &app,
        post_json("/v1/products/NUT-M8/stock-adjustments", json!({"delta": -4})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["stock"], 6);
}

#[tokio::test]
async fn lists_products_in_sku_order() {
    let app = test_app();
    for sku in ["WASHER-8", "BOLT-M6", "NUT-M6"] {
        send(
            &app,
            post_json(
                "/v1/products",
                json!({"sku": sku, "name": sku, "price_cents": 10}),
            ),
        )
        .await;
    }
    let (status, body) = send(&app, get("/v1/products?limit=2")).await;
    assert_eq!(status, StatusCode::OK);
    let skus: Vec<&str> = body
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["sku"].as_str().unwrap())
        .collect();
    assert_eq!(skus, ["BOLT-M6", "NUT-M6"]);
}

#[tokio::test]
async fn unknown_product_is_404() {
    let (status, _) = send(&test_app(), get("/v1/products/NOPE-1")).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}
