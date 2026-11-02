use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
};
use serde::Deserialize;

use crate::AppState;
use crate::store::{NewProduct, Product, StoreError};

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
    Query(params): Query<ListParams>,
) -> Result<Json<Vec<Product>>, (StatusCode, String)> {
    let limit = params.limit.unwrap_or(20);
    if !(1..=100).contains(&limit) {
        return Err((StatusCode::BAD_REQUEST, "limit must be 1-100".into()));
    }
    let products = state
        .store
        .list(params.offset.unwrap_or(0), limit)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(products))
}

pub async fn create_product(
    State(state): State<AppState>,
    Json(body): Json<CreateProduct>,
) -> Result<(StatusCode, Json<Product>), (StatusCode, String)> {
    if !valid_sku(&body.sku) {
        return Err((StatusCode::BAD_REQUEST, "invalid sku".into()));
    }
    if body.name.trim().is_empty() || body.name.chars().count() > 120 {
        return Err((StatusCode::BAD_REQUEST, "invalid name".into()));
    }
    if body.price_cents <= 0 {
        return Err((StatusCode::BAD_REQUEST, "invalid price".into()));
    }
    if body.stock < 0 {
        return Err((StatusCode::BAD_REQUEST, "invalid stock".into()));
    }
    let created = state.store.create(NewProduct {
        sku: body.sku,
        name: body.name.trim().to_string(),
        price_cents: body.price_cents,
        stock: body.stock,
    });
    match created {
        Ok(product) => Ok((StatusCode::CREATED, Json(product))),
        Err(StoreError::Duplicate(sku)) => {
            Err((StatusCode::CONFLICT, format!("{sku} already exists")))
        }
        Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
    }
}

pub async fn get_product(
    State(state): State<AppState>,
    Path(sku): Path<String>,
) -> Result<Json<Product>, StatusCode> {
    match state.store.get(&sku) {
        Ok(Some(product)) => Ok(Json(product)),
        Ok(None) => Err(StatusCode::NOT_FOUND),
        Err(_) => Err(StatusCode::INTERNAL_SERVER_ERROR),
    }
}

pub async fn adjust_stock(
    State(state): State<AppState>,
    Path(sku): Path<String>,
    Json(body): Json<StockAdjustment>,
) -> Result<Json<Product>, (StatusCode, String)> {
    if body.delta == 0 {
        return Err((StatusCode::BAD_REQUEST, "delta must not be zero".into()));
    }
    match state.store.adjust_stock(&sku, body.delta) {
        Ok(product) => Ok(Json(product)),
        Err(StoreError::NotFound(_)) => Err((StatusCode::NOT_FOUND, String::new())),
        Err(e @ StoreError::InsufficientStock { .. }) => {
            Err((StatusCode::CONFLICT, e.to_string()))
        }
        Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
    }
}
