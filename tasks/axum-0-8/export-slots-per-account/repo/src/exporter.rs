use std::future::Future;
use std::pin::Pin;
use std::time::Duration;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
pub struct ExportRequest {
    pub report: String,
    pub month: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Export {
    pub report: String,
    pub rows: u64,
    pub download_url: String,
}

#[derive(Debug, thiserror::Error)]
pub enum ExportError {
    #[error("unknown report {0:?}")]
    UnknownReport(String),
    #[error("export failed")]
    Failed(#[source] anyhow::Error),
}

pub type ExportFuture<'a> = Pin<Box<dyn Future<Output = Result<Export, ExportError>> + Send + 'a>>;

/// Runs one export to completion. Dropping the returned future abandons the export: the
/// warehouse query is cancelled and nothing is uploaded.
pub trait Exporter: Send + Sync + 'static {
    fn run<'a>(&'a self, account_id: &'a str, request: ExportRequest) -> ExportFuture<'a>;
}

/// Stand-in for the warehouse-backed exporter used in production.
pub struct WarehouseExporter;

impl Exporter for WarehouseExporter {
    fn run<'a>(&'a self, account_id: &'a str, request: ExportRequest) -> ExportFuture<'a> {
        Box::pin(async move {
            if !["orders", "invoices", "payouts"].contains(&request.report.as_str()) {
                return Err(ExportError::UnknownReport(request.report));
            }
            tokio::time::sleep(Duration::from_secs(8)).await;
            Ok(Export {
                download_url: format!(
                    "https://exports.example.com/{account_id}/{}-{}.csv",
                    request.report, request.month
                ),
                report: request.report,
                rows: 1_204,
            })
        })
    }
}
