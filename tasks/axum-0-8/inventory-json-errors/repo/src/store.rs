use std::collections::BTreeMap;
use std::sync::Mutex;

use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Product {
    pub sku: String,
    pub name: String,
    pub price_cents: i64,
    pub stock: i64,
}

#[derive(Debug, Clone)]
pub struct NewProduct {
    pub sku: String,
    pub name: String,
    pub price_cents: i64,
    pub stock: i64,
}

#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("product {0} already exists")]
    Duplicate(String),
    #[error("product {0} not found")]
    NotFound(String),
    #[error("stock for {sku} would drop to {would_be}")]
    InsufficientStock { sku: String, would_be: i64 },
    /// The database or driver failed. The message is whatever the driver said.
    #[error("storage backend failed: {0:#}")]
    Backend(anyhow::Error),
}

pub trait InventoryStore: Send + Sync + 'static {
    fn create(&self, product: NewProduct) -> Result<Product, StoreError>;
    fn get(&self, sku: &str) -> Result<Option<Product>, StoreError>;
    fn list(&self, offset: usize, limit: usize) -> Result<Vec<Product>, StoreError>;
    fn adjust_stock(&self, sku: &str, delta: i64) -> Result<Product, StoreError>;
}

#[derive(Default)]
pub struct MemoryStore {
    products: Mutex<BTreeMap<String, Product>>,
}

impl InventoryStore for MemoryStore {
    fn create(&self, product: NewProduct) -> Result<Product, StoreError> {
        let mut products = self.products.lock().unwrap();
        if products.contains_key(&product.sku) {
            return Err(StoreError::Duplicate(product.sku));
        }
        let created = Product {
            sku: product.sku,
            name: product.name,
            price_cents: product.price_cents,
            stock: product.stock,
        };
        products.insert(created.sku.clone(), created.clone());
        Ok(created)
    }

    fn get(&self, sku: &str) -> Result<Option<Product>, StoreError> {
        Ok(self.products.lock().unwrap().get(sku).cloned())
    }

    fn list(&self, offset: usize, limit: usize) -> Result<Vec<Product>, StoreError> {
        let products = self.products.lock().unwrap();
        Ok(products.values().skip(offset).take(limit).cloned().collect())
    }

    fn adjust_stock(&self, sku: &str, delta: i64) -> Result<Product, StoreError> {
        let mut products = self.products.lock().unwrap();
        let product = products
            .get_mut(sku)
            .ok_or_else(|| StoreError::NotFound(sku.to_string()))?;
        let would_be = product.stock + delta;
        if would_be < 0 {
            return Err(StoreError::InsufficientStock {
                sku: sku.to_string(),
                would_be,
            });
        }
        product.stock = would_be;
        Ok(product.clone())
    }
}
