use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
};
use serde::Deserialize;

use crate::AppState;
use crate::error::{ApiError, ApiJson, ApiQuery};
use crate::store::{NewProduct, Product};

#[derive(Debug, Deserialize)]
pub struct ListParams {
    pub offset: Option<usize>,
    pub limit: Option<usize>,
}

#[derive(Debug, Deserialize)]
pub struct CreateProduct {
    pub sku: String,
    pub name: String,
    pub price_cents: i64,
    #[serde(default)]
    pub stock: i64,
}

#[derive(Debug, Deserialize)]
pub struct StockAdjustment {
    pub delta: i64,
}

fn valid_sku(sku: &str) -> bool {
    (3..=32).contains(&sku.len())
        && sku
            .bytes()
            .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'-')
}

pub async fn list_products(
    State(state): State<AppState>,
    ApiQuery(params): ApiQuery<ListParams>,
) -> Result<Json<Vec<Product>>, ApiError> {
    let limit = params.limit.unwrap_or(20);
    if !(1..=100).contains(&limit) {
        return Err(ApiError::invalid_query("limit must be between 1 and 100"));
    }
    let products = state.store.list(params.offset.unwrap_or(0), limit)?;
    Ok(Json(products))
}

pub async fn create_product(
    State(state): State<AppState>,
    ApiJson(body): ApiJson<CreateProduct>,
) -> Result<(StatusCode, Json<Product>), ApiError> {
    if !valid_sku(&body.sku) {
        return Err(ApiError::validation(
            "sku must be 3 to 32 characters from A-Z, 0-9 and -",
        ));
    }
    if body.name.trim().is_empty() || body.name.chars().count() > 120 {
        return Err(ApiError::validation(
            "name must not be blank and at most 120 characters",
        ));
    }
    if body.price_cents <= 0 {
        return Err(ApiError::validation("price_cents must be positive"));
    }
    if body.stock < 0 {
        return Err(ApiError::validation("stock must not be negative"));
    }
    let product = state.store.create(NewProduct {
        sku: body.sku,
        name: body.name.trim().to_string(),
        price_cents: body.price_cents,
        stock: body.stock,
    })?;
    Ok((StatusCode::CREATED, Json(product)))
}

pub async fn get_product(
    State(state): State<AppState>,
    Path(sku): Path<String>,
) -> Result<Json<Product>, ApiError> {
    state
        .store
        .get(&sku)?
        .map(Json)
        .ok_or_else(|| ApiError::not_found(format!("product {sku} not found")))
}

pub async fn adjust_stock(
    State(state): State<AppState>,
    Path(sku): Path<String>,
    ApiJson(body): ApiJson<StockAdjustment>,
) -> Result<Json<Product>, ApiError> {
    if body.delta == 0 {
        return Err(ApiError::validation("delta must not be zero"));
    }
    Ok(Json(state.store.adjust_stock(&sku, body.delta)?))
}
