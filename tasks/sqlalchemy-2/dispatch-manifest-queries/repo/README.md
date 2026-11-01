# warehouse-dispatch

Builds the daily dispatch manifest for a warehouse: every shipment leaving that day, its carrier,
and each parcel with its contents. The floor app prints it and the carrier integration posts it.

- `warehouse/models.py`: SQLAlchemy 2 ORM models. Other services (picking, returns, invoicing)
  import these models too.
- `warehouse/manifest.py`: `dispatch_manifest(session, warehouse_code, day)`.
- `warehouse/db.py`: engine and session helpers. Production runs on SQLite (one file per site).

Shipments can be booked before anything is packed, so a shipment may have no parcels yet, and a
parcel can be labelled before items are scanned into it. Both still appear on the manifest.

## Development

```sh
python -m venv .venv
.venv/bin/pip install --require-hashes --no-deps -r requirements.lock
.venv/bin/python -m pytest
```
