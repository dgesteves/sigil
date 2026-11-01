# crm-sync

Nightly job that reads the CRM's customer export (`data/customers.csv` is a sample), cleans it
and uploads the result to billing. `crm/sync.py` builds the batch; the raw export is kept for the
audit log.

The CRM team adds free-text fields to the export now and then (`notes` was added last quarter),
so cleaning steps must not assume a fixed list of columns.

## Development

```sh
python -m venv .venv
.venv/bin/pip install --require-hashes --no-deps -r requirements.lock
.venv/bin/python -m pytest
```

`requirements.lock` is generated from `pyproject.toml` with
`uv pip compile pyproject.toml --group dev --generate-hashes --universal --python-version 3.14 -o requirements.lock`.
