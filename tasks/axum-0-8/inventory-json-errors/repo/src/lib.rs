//! Inventory API: products and their stock levels.

pub mod routes;
pub mod store;

use std::sync::Arc;

use axum::{
    Router,
    extract::DefaultBodyLimit,
    routing::{get, post},
};

pub use store::{InventoryStore, MemoryStore, NewProduct, Product, StoreError};

/// Largest request body the API accepts.
pub const MAX_BODY_BYTES: usize = 16 * 1024;

#[derive(Clone)]
pub struct AppState {
    pub store: Arc<dyn InventoryStore>,
}

impl AppState {
    pub fn new(store: impl InventoryStore) -> Self {
        Self {
            store: Arc::new(store),
        }
    }
}

pub fn app(state: AppState) -> Router {
    Router::new()
        .route(
            "/v1/products",
            get(routes::list_products).post(routes::create_product),
        )
        .route("/v1/products/{sku}", get(routes::get_product))
        .route(
            "/v1/products/{sku}/stock-adjustments",
            post(routes::adjust_stock),
        )
        .layer(DefaultBodyLimit::max(MAX_BODY_BYTES))
        .with_state(state)
}
