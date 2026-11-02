//! Listings API.

pub mod routes;
pub mod state;

use axum::{
    Router,
    extract::DefaultBodyLimit,
    routing::{get, post, put},
};
use tower_http::{limit::RequestBodyLimitLayer, trace::TraceLayer};

pub use state::{AppState, Listing, Photo};

/// Listing bodies are a few hundred bytes; anything this big is a client bug or abuse.
pub const JSON_BODY_LIMIT: usize = 64 * 1024;

/// Phone camera photos, with headroom.
pub const PHOTO_BODY_LIMIT: usize = 15 * 1024 * 1024;

pub fn app(state: AppState) -> Router {
    let json_api = Router::new()
        .route("/v1/listings", post(routes::create_listing))
        .route(
            "/v1/listings/{id}",
            get(routes::get_listing).patch(routes::update_listing),
        )
        .layer(RequestBodyLimitLayer::new(JSON_BODY_LIMIT));

    // The `Bytes` extractor enforces DefaultBodyLimit (2 MB unless changed), whatever
    // RequestBodyLimitLayer allows, so the upload route sets its own DefaultBodyLimit. It also
    // applies to chunked bodies that carry no Content-Length.
    let uploads = Router::new()
        .route("/v1/listings/{id}/photos/{slot}", put(routes::put_photo))
        .layer(DefaultBodyLimit::max(PHOTO_BODY_LIMIT));

    json_api
        .merge(uploads)
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}
