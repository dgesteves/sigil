# payments-gateway

Starts checkouts for the storefront and receives payment events from Acme Pay (FastAPI).

- `app/main.py`: `create_app(settings)`.
- `app/checkout.py`: `POST /checkouts` (JSON body).
- `app/webhooks.py`: `POST /webhooks/acme-pay`, signed with HMAC-SHA256 over the raw body. Events land
  in an idempotent ledger keyed by event id. See `docs/acme-webhooks.md` for what Acme sends.

## Development

```sh
python -m venv .venv && .venv/bin/pip install --require-hashes --no-deps -r requirements.lock
.venv/bin/python -m pytest
```

`requirements.lock` is generated from `pyproject.toml` with
`uv pip compile pyproject.toml --group dev --generate-hashes --universal --python-version 3.14 -o requirements.lock`.
