# parcel-tracking

Receives the carrier's tracking webhooks and builds the shipment timeline. The HTTP handler calls
`tracking.webhook.parse_event(body)`, answers 422 with `InvalidEvent.fields` when it raises, and
writes `event_row(event)` to the `tracking_events` table. The replay tool and our tests also build
`TrackingEvent` objects directly, with snake_case keyword arguments
(`TrackingEvent(tracking_number=..., status=..., occurred_at=...)`).

Payload format: [docs/carrier-webhook.md](docs/carrier-webhook.md).

## Development

```sh
python -m venv .venv && .venv/bin/pip install --require-hashes --no-deps -r requirements.lock
.venv/bin/python -m pytest
```
