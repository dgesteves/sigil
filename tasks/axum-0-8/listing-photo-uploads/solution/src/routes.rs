use axum::{
    Json,
    body::Bytes,
    extract::{Path, State},
    http::{HeaderMap, StatusCode, header},
};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::state::{AppState, Listing, Photo};

const PHOTO_TYPES: [&str; 3] = ["image/jpeg", "image/png", "image/webp"];

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

pub async fn put_photo(
    State(state): State<AppState>,
    Path((id, slot)): Path<(u64, u8)>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<(StatusCode, Json<Value>), StatusCode> {
    if !(1..=20).contains(&slot) {
        return Err(StatusCode::BAD_REQUEST);
    }
    let content_type = headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| PHOTO_TYPES.iter().find(|t| **t == v))
        .ok_or(StatusCode::UNSUPPORTED_MEDIA_TYPE)?;
    let size = body.len();
    let photo = Photo {
        content_type: content_type.to_string(),
        data: body,
    };
    if !state.put_photo(id, slot, photo) {
        return Err(StatusCode::NOT_FOUND);
    }
    Ok((
        StatusCode::CREATED,
        Json(json!({
            "listing_id": id,
            "slot": slot,
            "content_type": content_type,
            "size": size,
        })),
    ))
}
