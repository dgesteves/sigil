use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode, header},
};
use http_body_util::BodyExt;
use listings_api::{AppState, app};
use serde_json::{Value, json};
use tower::ServiceExt;

async fn send(app: &Router, req: Request<Body>) -> (StatusCode, Value) {
    let res = app.clone().oneshot(req).await.unwrap();
    let status = res.status();
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    (status, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
}

fn json_req(method: &str, uri: &str, body: String) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(uri)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body))
        .unwrap()
}

#[tokio::test]
async fn creates_reads_and_updates_a_listing() {
    let app = app(AppState::default());
    let (status, created) = send(
        &app,
        json_req(
            "POST",
            "/v1/listings",
            json!({"title": "Two-bed flat", "city": "Porto", "price_eur": 315000}).to_string(),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(created["photos"], json!([]));
    let id = created["id"].as_u64().unwrap();

    let (status, updated) = send(
        &app,
        json_req("PATCH", &format!("/v1/listings/{id}"), json!({"price_eur": 299000}).to_string()),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(updated["price_eur"], 299000);

    let (status, fetched) = send(
        &app,
        Request::get(format!("/v1/listings/{id}")).body(Body::empty()).unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(fetched, updated);
}

#[tokio::test]
async fn rejects_oversized_json_bodies() {
    let app = app(AppState::default());
    let title = "x".repeat(80 * 1024);
    let (status, _) = send(
        &app,
        json_req(
            "POST",
            "/v1/listings",
            json!({"title": title, "city": "Porto", "price_eur": 1}).to_string(),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE);
}
