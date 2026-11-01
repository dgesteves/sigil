# orders-api

Order intake for the storefront and the mobile app. FastAPI on SQLite (one file per environment;
production runs `uvicorn app.asgi:app` with several workers against a shared volume).

- `app/main.py`: `create_app(database, *, connection_class=...)` builds the app. Tests call it with a
  temporary database file; `connection_class` lets tests swap in a `sqlite3.Connection` subclass.
- `app/db.py`: schema, connections and the per-request `get_db` dependency.
- `app/routers/orders.py`: the HTTP endpoints. `app/repository.py`: the SQL.

## Endpoints

| Method | Path | Success | Errors |
| --- | --- | --- | --- |
| POST | `/orders` | 201, `Location: /orders/{id}` | 422 invalid body |
| GET | `/orders/{id}` | 200 | 404 |
| POST | `/orders/{id}/cancel` | 200 | 404, 409 already cancelled |

## Development

```sh
python -m venv .venv && .venv/bin/pip install --require-hashes --no-deps -r requirements.lock
.venv/bin/python -m pytest
```

`requirements.lock` is generated from `pyproject.toml` with
`uv pip compile pyproject.toml --group dev --generate-hashes --universal --python-version 3.14 -o requirements.lock`.
