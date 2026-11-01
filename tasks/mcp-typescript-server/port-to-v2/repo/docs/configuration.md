# Configuration

Relay reads `relay.toml` from the project root.

- `forward_url`: where events are delivered.
- `retries`: how many times a failed delivery is retried (default 5, maximum 10).
- `timeout_ms`: how long Relay waits for your handler before it counts a delivery as failed.
- `filters`: event types to forward; everything else is dropped.

Changes take effect on the next deploy. Secrets never go in `relay.toml`; use environment
variables instead.
