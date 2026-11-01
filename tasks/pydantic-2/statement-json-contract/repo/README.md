# billing-statements

Monthly account statements. `statements/models.py` holds the models the billing run builds (with
Python field names, from database rows), and `statements/render.py` turns a statement into the
document served by `GET /statements/{id}` and cached by the API gateway.

The public JSON contract is in [docs/statement-api.md](docs/statement-api.md).

## Development

```sh
python -m venv .venv && .venv/bin/pip install --require-hashes --no-deps -r requirements.lock
.venv/bin/python -m pytest
```
