use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde_json::json;

use crate::AppState;
use crate::exporter::{ExportError, ExportRequest};

pub async fn create_export(
    State(state): State<AppState>,
    Path(account_id): Path<String>,
    Json(request): Json<ExportRequest>,
) -> Response {
    match state.exporter.run(&account_id, request).await {
        Ok(export) => Json(export).into_response(),
        Err(ExportError::UnknownReport(_)) => (
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(json!({"error": "unknown_report"})),
        )
            .into_response(),
        Err(err @ ExportError::Failed(_)) => {
            tracing::error!(error = ?err, %account_id, "export failed");
            (
                StatusCode::BAD_GATEWAY,
                Json(json!({"error": "export_failed"})),
            )
                .into_response()
        }
    }
}
