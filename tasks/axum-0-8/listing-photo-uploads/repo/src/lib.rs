//! Listings API.

pub mod routes;
pub mod state;

use axum::{
    Router,
    routing::{get, post},
};
use tower_http::{limit::RequestBodyLimitLayer, trace::TraceLayer};

pub use state::{AppState, Listing, Photo};

/// Listing bodies are a few hundred bytes; anything this big is a client bug or abuse.
pub const JSON_BODY_LIMIT: usize = 64 * 1024;

pub fn app(state: AppState) -> Router {
    Router::new()
        .route("/v1/listings", post(routes::create_listing))
        .route(
            "/v1/listings/{id}",
            get(routes::get_listing).patch(routes::update_listing),
        )
        .layer(RequestBodyLimitLayer::new(JSON_BODY_LIMIT))
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}
