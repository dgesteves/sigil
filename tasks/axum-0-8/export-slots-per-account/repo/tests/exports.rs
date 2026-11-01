use anyhow::anyhow;
use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode, header},
};
use http_body_util::BodyExt;
use reports_api::{AppState, Export, ExportError, ExportFuture, ExportRequest, Exporter, app};
use serde_json::{Value, json};
use tower::ServiceExt;

/// Finishes immediately: "payouts" fails, unknown reports are rejected.
struct InstantExporter;

impl Exporter for InstantExporter {
    fn run<'a>(&'a self, account_id: &'a str, request: ExportRequest) -> ExportFuture<'a> {
        Box::pin(async move {
            match request.report.as_str() {
                "orders" | "invoices" => Ok(Export {
                    download_url: format!("https://files.test/{account_id}/{}.csv", request.month),
                    report: request.report,
                    rows: 3,
                }),
                "payouts" => Err(ExportError::Failed(anyhow!("warehouse unavailable"))),
                other => Err(ExportError::UnknownReport(other.to_string())),
            }
        })
    }
}

async fn export(app: &Router, account: &str, report: &str) -> (StatusCode, Value) {
    let req = Request::post(format!("/v1/accounts/{account}/exports"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({"report": report, "month": "2026-10"}).to_string()))
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    let status = res.status();
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    (status, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
}

#[tokio::test]
async fn returns_the_export() {
    let app = app(AppState::new(InstantExporter));
    let (status, body) = export(&app, "acct_7", "orders").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body,
        json!({"report": "orders", "rows": 3, "download_url": "https://files.test/acct_7/2026-10.csv"})
    );
}

#[tokio::test]
async fn maps_export_errors() {
    let app = app(AppState::new(InstantExporter));
    assert_eq!(
        export(&app, "acct_7", "refunds").await,
        (StatusCode::UNPROCESSABLE_ENTITY, json!({"error": "unknown_report"}))
    );
    assert_eq!(
        export(&app, "acct_7", "payouts").await,
        (StatusCode::BAD_GATEWAY, json!({"error": "export_failed"}))
    );
}
