# claims-intake

Request models and helpers for the claims intake API. The HTTP layer (not in this repo) calls the
functions in `claims/api.py`:

- `parse_claim` / `parse_batch` validate request bodies from the mobile app and partner portals;
- `claim_json` / `batch_json` produce response bodies, and `claim_document` the copy we store in the
  document database. Partner integrations parse these responses, so their JSON is a contract;
- `api_errors` turns a `ValidationError` into the 422 response body;
- `claim_from_row` builds a claim from a database row object, and `with_changes` applies an
  adjuster's edits.

## Development

```sh
python -m venv .venv && .venv/bin/pip install --require-hashes --no-deps -r requirements.lock
.venv/bin/python -m pytest
```

Dependencies are pinned in `pyproject.toml` and locked with hashes in `requirements.lock`
(`uv pip compile pyproject.toml --group dev --generate-hashes --universal --python-version 3.14 -o requirements.lock`).
