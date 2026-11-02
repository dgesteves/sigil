//! Hidden verifier for the per-account export limit: two exports per account at a time, 429 with
//! Retry-After for the third, independent accounts, and slots that come back when an export
//! succeeds, fails, is abandoned by the client, or is cut off by the request timeout.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use anyhow::anyhow;
use axum::{
    Router,
    body::Body,
    http::{HeaderMap, Request, StatusCode, header},
};
use http_body_util::BodyExt;
use reports_api::{AppState, Export, ExportError, ExportFuture, ExportRequest, Exporter, app};
use serde_json::{Value, json};
use tokio::sync::{oneshot, watch};
use tokio::task::JoinHandle;
use tower::ServiceExt;

type Outcome = Result<Export, ExportError>;

#[derive(Default, Clone, Debug)]
struct Counts {
    /// (account, month) of every export that started, in order.
    started: Vec<(String, String)>,
    /// Exports whose future was dropped before they finished.
    cancelled: usize,
}

/// An exporter that blocks every export until the test finishes it.
#[derive(Clone)]
struct GateExporter {
    counts: Arc<watch::Sender<Counts>>,
    pending: Arc<Mutex<HashMap<(String, String), oneshot::Sender<Outcome>>>>,
}

impl GateExporter {
    fn new() -> Self {
        Self {
            counts: Arc::new(watch::Sender::new(Counts::default())),
            pending: Arc::default(),
        }
    }

    fn started(&self, account: &str) -> usize {
        self.counts.borrow().started.iter().filter(|(a, _)| a == account).count()
    }

    fn cancelled(&self) -> usize {
        self.counts.borrow().cancelled
    }

    async fn wait_until(&self, what: &str, cond: impl FnMut(&Counts) -> bool) {
        let mut rx = self.counts.subscribe();
        let waited = tokio::time::timeout(Duration::from_secs(5), rx.wait_for(cond)).await;
        assert!(waited.is_ok(), "timed out waiting until {what}; counts: {:?}", *self.counts.borrow());
    }

    async fn wait_started(&self, account: &str, n: usize) {
        let what = format!("{n} exports for {account} have started");
        self.wait_until(&what, |c| c.started.iter().filter(|(a, _)| a == account).count() >= n)
            .await;
    }

    fn finish(&self, account: &str, month: &str, outcome: Outcome) {
        let tx = self
            .pending
            .lock()
            .unwrap()
            .remove(&(account.to_string(), month.to_string()))
            .unwrap_or_else(|| panic!("no running export for {account} {month}"));
        let _ = tx.send(outcome);
    }
}

struct CancelProbe {
    counts: Arc<watch::Sender<Counts>>,
    finished: bool,
}

impl Drop for CancelProbe {
    fn drop(&mut self) {
        if !self.finished {
            self.counts.send_modify(|c| c.cancelled += 1);
        }
    }
}

impl Exporter for GateExporter {
    fn run<'a>(&'a self, account_id: &'a str, request: ExportRequest) -> ExportFuture<'a> {
        Box::pin(async move {
            let key = (account_id.to_string(), request.month.clone());
            let (tx, rx) = oneshot::channel();
            self.pending.lock().unwrap().insert(key.clone(), tx);
            self.counts.send_modify(|c| c.started.push(key));
            let mut probe = CancelProbe {
                counts: self.counts.clone(),
                finished: false,
            };
            let outcome = rx
                .await
                .unwrap_or_else(|_| Err(ExportError::Failed(anyhow!("test gate dropped"))));
            probe.finished = true;
            outcome
        })
    }
}

fn done(account: &str, month: &str) -> Outcome {
    Ok(Export {
        report: "orders".into(),
        rows: 42,
        download_url: format!("https://files.test/{account}/{month}.csv"),
    })
}

fn request(account: &str, month: &str) -> Request<Body> {
    Request::post(format!("/v1/accounts/{account}/exports"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({"report": "orders", "month": month}).to_string()))
        .unwrap()
}

#[derive(Debug)]
struct Reply {
    status: StatusCode,
    headers: HeaderMap,
    body: Value,
}

async fn reply(res: axum::response::Response) -> Reply {
    let status = res.status();
    let headers = res.headers().clone();
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    Reply {
        status,
        headers,
        body: serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    }
}

fn spawn(app: &Router, account: &str, month: &str) -> JoinHandle<Reply> {
    let fut = app.clone().oneshot(request(account, month));
    tokio::spawn(async move { reply(fut.await.unwrap()).await })
}

async fn finished(handle: JoinHandle<Reply>) -> Reply {
    tokio::time::timeout(Duration::from_secs(5), handle)
        .await
        .expect("request did not finish")
        .unwrap()
}

/// A request that must be answered right away (it must not start or wait for an export).
async fn immediate(app: &Router, account: &str, month: &str) -> Reply {
    let res = tokio::time::timeout(Duration::from_secs(5), app.clone().oneshot(request(account, month)))
        .await
        .expect("request was not answered right away")
        .unwrap();
    reply(res).await
}

fn assert_rejected(r: &Reply, what: &str) {
    assert_eq!(r.status, StatusCode::TOO_MANY_REQUESTS, "{what}: {}", r.body);
    assert_eq!(
        r.headers.get(header::RETRY_AFTER).and_then(|v| v.to_str().ok()),
        Some("30"),
        "{what}: Retry-After"
    );
    assert_eq!(r.body, json!({"error": "too_many_exports"}), "{what}: body");
}

#[tokio::test]
async fn third_concurrent_export_is_rejected() {
    let gate = GateExporter::new();
    let app = app(AppState::new(gate.clone()));
    let jan = spawn(&app, "acme", "2026-01");
    let feb = spawn(&app, "acme", "2026-02");
    gate.wait_started("acme", 2).await;

    let r = immediate(&app, "acme", "2026-03").await;
    assert_rejected(&r, "third export while two run");
    assert_eq!(gate.started("acme"), 2, "a rejected request must not start an export");

    gate.finish("acme", "2026-01", done("acme", "2026-01"));
    let r = finished(jan).await;
    assert_eq!(r.status, StatusCode::OK);
    assert_eq!(r.body["download_url"], "https://files.test/acme/2026-01.csv");

    let mar = spawn(&app, "acme", "2026-03");
    gate.wait_started("acme", 3).await;
    let r = immediate(&app, "acme", "2026-04").await;
    assert_rejected(&r, "limit still applies after a slot was reused");

    gate.finish("acme", "2026-02", done("acme", "2026-02"));
    gate.finish("acme", "2026-03", done("acme", "2026-03"));
    assert_eq!(finished(feb).await.status, StatusCode::OK);
    assert_eq!(finished(mar).await.status, StatusCode::OK);
}

#[tokio::test]
async fn accounts_do_not_share_slots() {
    let gate = GateExporter::new();
    let app = app(AppState::new(gate.clone()));
    let a1 = spawn(&app, "acme", "2026-01");
    let a2 = spawn(&app, "acme", "2026-02");
    gate.wait_started("acme", 2).await;

    let g1 = spawn(&app, "globex", "2026-01");
    let g2 = spawn(&app, "globex", "2026-02");
    gate.wait_started("globex", 2).await;
    assert_rejected(&immediate(&app, "globex", "2026-03").await, "third globex export");

    gate.finish("globex", "2026-01", done("globex", "2026-01"));
    gate.finish("globex", "2026-02", done("globex", "2026-02"));
    assert_eq!(finished(g1).await.status, StatusCode::OK);
    assert_eq!(finished(g2).await.status, StatusCode::OK);

    gate.finish("acme", "2026-01", done("acme", "2026-01"));
    gate.finish("acme", "2026-02", done("acme", "2026-02"));
    assert_eq!(finished(a1).await.status, StatusCode::OK);
    assert_eq!(finished(a2).await.status, StatusCode::OK);
}

#[tokio::test]
async fn failed_exports_free_their_slot() {
    let gate = GateExporter::new();
    let app = app(AppState::new(gate.clone()));
    let jan = spawn(&app, "initech", "2026-01");
    let feb = spawn(&app, "initech", "2026-02");
    gate.wait_started("initech", 2).await;

    gate.finish("initech", "2026-01", Err(ExportError::Failed(anyhow!("warehouse timeout"))));
    let r = finished(jan).await;
    assert_eq!((r.status, r.body), (StatusCode::BAD_GATEWAY, json!({"error": "export_failed"})));

    gate.finish("initech", "2026-02", Err(ExportError::UnknownReport("orders".into())));
    let r = finished(feb).await;
    assert_eq!(r.status, StatusCode::UNPROCESSABLE_ENTITY);

    let mar = spawn(&app, "initech", "2026-03");
    let apr = spawn(&app, "initech", "2026-04");
    gate.wait_started("initech", 4).await;
    gate.finish("initech", "2026-03", done("initech", "2026-03"));
    gate.finish("initech", "2026-04", done("initech", "2026-04"));
    assert_eq!(finished(mar).await.status, StatusCode::OK);
    assert_eq!(finished(apr).await.status, StatusCode::OK);
}

#[tokio::test]
async fn abandoned_requests_stop_the_export_and_free_the_slot() {
    let gate = GateExporter::new();
    let app = app(AppState::new(gate.clone()));
    let jan = spawn(&app, "umbrella", "2026-01");
    let feb = spawn(&app, "umbrella", "2026-02");
    gate.wait_started("umbrella", 2).await;

    // The client disconnects: hyper drops the request future, which is what abort() does here.
    jan.abort();
    feb.abort();
    assert!(jan.await.unwrap_err().is_cancelled());
    assert!(feb.await.unwrap_err().is_cancelled());
    gate.wait_until("both abandoned exports were stopped", |c| c.cancelled >= 2).await;

    let mar = spawn(&app, "umbrella", "2026-03");
    let apr = spawn(&app, "umbrella", "2026-04");
    gate.wait_started("umbrella", 4).await;
    assert_rejected(&immediate(&app, "umbrella", "2026-05").await, "limit after abandoned requests");

    gate.finish("umbrella", "2026-03", done("umbrella", "2026-03"));
    gate.finish("umbrella", "2026-04", done("umbrella", "2026-04"));
    assert_eq!(finished(mar).await.status, StatusCode::OK);
    assert_eq!(finished(apr).await.status, StatusCode::OK);
}

#[tokio::test(start_paused = true)]
async fn timed_out_requests_free_their_slot() {
    let gate = GateExporter::new();
    let app = app(AppState::new(gate.clone()));
    // Nothing finishes these exports, so the paused clock runs straight to REQUEST_TIMEOUT.
    let (jan, feb) = tokio::join!(
        app.clone().oneshot(request("hooli", "2026-01")),
        app.clone().oneshot(request("hooli", "2026-02")),
    );
    assert_eq!(jan.unwrap().status(), StatusCode::GATEWAY_TIMEOUT);
    assert_eq!(feb.unwrap().status(), StatusCode::GATEWAY_TIMEOUT);
    assert_eq!(gate.cancelled(), 2, "timed-out exports must be stopped");

    for month in ["2026-03", "2026-04", "2026-05"] {
        let r = app.clone().oneshot(request("hooli", month)).await.unwrap();
        assert_eq!(
            r.status(),
            StatusCode::GATEWAY_TIMEOUT,
            "{month}: after timeouts the account must get its slots back"
        );
    }
    assert_eq!(gate.started("hooli"), 5);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_burst_starts_exactly_two() {
    let gate = GateExporter::new();
    let app = app(AppState::new(gate.clone()));
    let months: Vec<String> = (1..=16).map(|m| format!("2025-{m:02}")).collect();
    let mut handles: Vec<(String, JoinHandle<Reply>)> =
        months.iter().map(|m| (m.clone(), spawn(&app, "wayne", m))).collect();

    gate.wait_started("wayne", 2).await;
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    while handles.iter().filter(|(_, h)| h.is_finished()).count() < 14 {
        assert!(tokio::time::Instant::now() < deadline, "14 requests should be rejected quickly");
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert_eq!(gate.started("wayne"), 2, "exactly two exports may start");

    let running: Vec<String> = gate
        .counts
        .borrow()
        .started
        .iter()
        .map(|(_, m)| m.clone())
        .collect();
    for (month, handle) in handles.drain(..) {
        if running.contains(&month) {
            gate.finish("wayne", &month, done("wayne", &month));
            assert_eq!(finished(handle).await.status, StatusCode::OK);
        } else {
            assert_rejected(&finished(handle).await, &format!("burst request {month}"));
        }
    }
}
