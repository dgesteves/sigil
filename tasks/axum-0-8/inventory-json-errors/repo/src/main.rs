use inventory_api::{AppState, MemoryStore, app};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt::init();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:3000").await?;
    tracing::info!(addr = %listener.local_addr()?, "listening");
    axum::serve(listener, app(AppState::new(MemoryStore::default()))).await?;
    Ok(())
}
