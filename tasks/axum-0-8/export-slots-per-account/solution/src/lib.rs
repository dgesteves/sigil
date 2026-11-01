//! Reports API: account report exports.

pub mod exporter;
pub mod routes;
pub mod slots;

use std::sync::Arc;
use std::time::Duration;

use axum::{
    Router,
    http::StatusCode,
    routing::{get, post},
};
use tower_http::{timeout::TimeoutLayer, trace::TraceLayer};

pub use exporter::{Export, ExportError, ExportFuture, ExportRequest, Exporter, WarehouseExporter};

/// The gateway gives up after 60 s; answer a little earlier so the client gets a real status.
pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(55);

/// Exports one account may run at the same time.
pub const MAX_EXPORTS_PER_ACCOUNT: usize = 2;

#[derive(Clone)]
pub struct AppState {
    pub exporter: Arc<dyn Exporter>,
    pub slots: slots::ExportSlots,
}

impl AppState {
    pub fn new(exporter: impl Exporter) -> Self {
        Self {
            exporter: Arc::new(exporter),
            slots: slots::ExportSlots::new(MAX_EXPORTS_PER_ACCOUNT),
        }
    }
}

pub fn app(state: AppState) -> Router {
    Router::new()
        .route(
            "/v1/accounts/{account_id}/exports",
            post(routes::create_export),
        )
        .route("/healthz", get(|| async { "ok" }))
        .layer(TimeoutLayer::with_status_code(
            StatusCode::GATEWAY_TIMEOUT,
            REQUEST_TIMEOUT,
        ))
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}
