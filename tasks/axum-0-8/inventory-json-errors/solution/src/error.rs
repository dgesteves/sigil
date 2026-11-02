//! The one error type every handler returns, and the extractors that route axum's own rejections
//! through it.

use axum::{
    Json,
    extract::{
        FromRequest, FromRequestParts,
        rejection::{JsonRejection, QueryRejection},
    },
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde_json::json;

use crate::store::StoreError;

#[derive(Debug)]
pub struct ApiError {
    status: StatusCode,
    code: &'static str,
    message: String,
}

impl ApiError {
    pub fn new(status: StatusCode, code: &'static str, message: impl Into<String>) -> Self {
        Self {
            status,
            code,
            message: message.into(),
        }
    }

    pub fn validation(message: impl Into<String>) -> Self {
        Self::new(StatusCode::UNPROCESSABLE_ENTITY, "validation_failed", message)
    }

    pub fn invalid_query(message: impl Into<String>) -> Self {
        Self::new(StatusCode::BAD_REQUEST, "invalid_query", message)
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new(StatusCode::NOT_FOUND, "not_found", message)
    }

    pub fn internal() -> Self {
        Self::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal",
            "internal server error",
        )
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let body = json!({ "error": { "code": self.code, "message": self.message } });
        (self.status, Json(body)).into_response()
    }
}

impl From<StoreError> for ApiError {
    fn from(err: StoreError) -> Self {
        match err {
            StoreError::Duplicate(sku) => Self::new(
                StatusCode::CONFLICT,
                "already_exists",
                format!("product {sku} already exists"),
            ),
            StoreError::NotFound(sku) => Self::not_found(format!("product {sku} not found")),
            err @ StoreError::InsufficientStock { .. } => {
                Self::new(StatusCode::CONFLICT, "insufficient_stock", err.to_string())
            }
            StoreError::Backend(source) => {
                // The driver message can carry hosts, users and SQL: log it, never return it.
                tracing::error!(error = format!("{source:#}"), "inventory store failed");
                Self::internal()
            }
        }
    }
}

impl From<JsonRejection> for ApiError {
    fn from(rejection: JsonRejection) -> Self {
        let code = match &rejection {
            JsonRejection::JsonDataError(_) => "invalid_body",
            JsonRejection::JsonSyntaxError(_) => "malformed_json",
            JsonRejection::MissingJsonContentType(_) => "unsupported_media_type",
            _ if rejection.status() == StatusCode::PAYLOAD_TOO_LARGE => "payload_too_large",
            _ => "malformed_json",
        };
        Self::new(rejection.status(), code, rejection.body_text())
    }
}

impl From<QueryRejection> for ApiError {
    fn from(rejection: QueryRejection) -> Self {
        Self::invalid_query(rejection.body_text())
    }
}

/// `axum::Json` whose rejections are `ApiError`s.
#[derive(FromRequest)]
#[from_request(via(axum::Json), rejection(ApiError))]
pub struct ApiJson<T>(pub T);

/// `axum::extract::Query` whose rejections are `ApiError`s.
#[derive(FromRequestParts)]
#[from_request(via(axum::extract::Query), rejection(ApiError))]
pub struct ApiQuery<T>(pub T);

pub async fn not_found_fallback() -> ApiError {
    ApiError::not_found("no route matches this path")
}

pub async fn method_not_allowed_fallback() -> ApiError {
    ApiError::new(
        StatusCode::METHOD_NOT_ALLOWED,
        "method_not_allowed",
        "this path does not support that method",
    )
}
