use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
};
use serde::Deserialize;

use crate::state::{AppState, Listing};

#[derive(Debug, Deserialize)]
pub struct NewListing {
    pub title: String,
    pub city: String,
    pub price_eur: u64,
}

#[derive(Debug, Deserialize)]
pub struct ListingChanges {
    pub title: Option<String>,
    pub city: Option<String>,
    pub price_eur: Option<u64>,
}

pub async fn create_listing(
    State(state): State<AppState>,
    Json(body): Json<NewListing>,
) -> Result<(StatusCode, Json<Listing>), StatusCode> {
    if body.title.trim().is_empty() || body.city.trim().is_empty() {
        return Err(StatusCode::UNPROCESSABLE_ENTITY);
    }
    let listing = state.create_listing(body.title, body.city, body.price_eur);
    Ok((StatusCode::CREATED, Json(listing)))
}

pub async fn get_listing(
    State(state): State<AppState>,
    Path(id): Path<u64>,
) -> Result<Json<Listing>, StatusCode> {
    state.listing(id).map(Json).ok_or(StatusCode::NOT_FOUND)
}

pub async fn update_listing(
    State(state): State<AppState>,
    Path(id): Path<u64>,
    Json(changes): Json<ListingChanges>,
) -> Result<Json<Listing>, StatusCode> {
    state
        .update_listing(id, |listing| {
            if let Some(title) = changes.title {
                listing.title = title;
            }
            if let Some(city) = changes.city {
                listing.city = city;
            }
            if let Some(price) = changes.price_eur {
                listing.price_eur = price;
            }
        })
        .map(Json)
        .ok_or(StatusCode::NOT_FOUND)
}
