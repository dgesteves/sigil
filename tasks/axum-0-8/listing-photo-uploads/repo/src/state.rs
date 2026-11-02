use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use axum::body::Bytes;
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Listing {
    pub id: u64,
    pub title: String,
    pub city: String,
    pub price_eur: u64,
    /// Occupied photo slots, ascending.
    pub photos: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Photo {
    pub content_type: String,
    pub data: Bytes,
}

#[derive(Default)]
struct Data {
    next_id: u64,
    listings: BTreeMap<u64, Listing>,
    photos: BTreeMap<(u64, u8), Photo>,
}

/// Shared application state. Cloning is cheap; clones share the same data.
#[derive(Clone, Default)]
pub struct AppState {
    data: Arc<Mutex<Data>>,
}

impl AppState {
    pub fn create_listing(&self, title: String, city: String, price_eur: u64) -> Listing {
        let mut data = self.data.lock().unwrap();
        data.next_id += 1;
        let listing = Listing {
            id: data.next_id,
            title,
            city,
            price_eur,
            photos: Vec::new(),
        };
        data.listings.insert(listing.id, listing.clone());
        listing
    }

    pub fn listing(&self, id: u64) -> Option<Listing> {
        self.data.lock().unwrap().listings.get(&id).cloned()
    }

    /// Applies `change` to the listing and returns the result, or `None` if it doesn't exist.
    pub fn update_listing(&self, id: u64, change: impl FnOnce(&mut Listing)) -> Option<Listing> {
        let mut data = self.data.lock().unwrap();
        let listing = data.listings.get_mut(&id)?;
        change(listing);
        Some(listing.clone())
    }

    /// Stores `photo` in `slot`, replacing any previous one. Returns `false` if the listing
    /// doesn't exist.
    pub fn put_photo(&self, listing_id: u64, slot: u8, photo: Photo) -> bool {
        let mut data = self.data.lock().unwrap();
        let Some(listing) = data.listings.get_mut(&listing_id) else {
            return false;
        };
        if let Err(at) = listing.photos.binary_search(&slot) {
            listing.photos.insert(at, slot);
        }
        data.photos.insert((listing_id, slot), photo);
        true
    }

    pub fn photo(&self, listing_id: u64, slot: u8) -> Option<Photo> {
        self.data.lock().unwrap().photos.get(&(listing_id, slot)).cloned()
    }
}
