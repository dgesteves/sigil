//! Per-account cap on concurrently running exports.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

#[derive(Clone)]
pub struct ExportSlots {
    per_account: usize,
    running: Arc<Mutex<HashMap<String, usize>>>,
}

/// Holds one slot until dropped. Keep it alive across the export's `.await`: when the export
/// finishes, fails, or its future is dropped (client gone, request timed out), the drop frees it.
/// Code placed after the `.await` would not run in the last case.
pub struct Slot {
    account: String,
    running: Arc<Mutex<HashMap<String, usize>>>,
}

impl ExportSlots {
    pub fn new(per_account: usize) -> Self {
        Self {
            per_account,
            running: Arc::default(),
        }
    }

    /// Takes a slot for `account`, or returns `None` when all of its slots are in use.
    pub fn try_acquire(&self, account: &str) -> Option<Slot> {
        let mut running = self.running.lock().unwrap();
        let count = running.entry(account.to_string()).or_insert(0);
        if *count >= self.per_account {
            return None;
        }
        *count += 1;
        Some(Slot {
            account: account.to_string(),
            running: Arc::clone(&self.running),
        })
    }
}

impl Drop for Slot {
    fn drop(&mut self) {
        let mut running = self.running.lock().unwrap();
        if let Some(count) = running.get_mut(&self.account) {
            *count -= 1;
            if *count == 0 {
                // Don't keep an entry for every account that ever exported.
                running.remove(&self.account);
            }
        }
    }
}
