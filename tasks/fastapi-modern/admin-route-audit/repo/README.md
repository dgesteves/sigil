# backoffice

Back-office API for support and finance staff (FastAPI). Everything under `/admin` must require an
admin token (`X-Admin-Token`, checked by `require_admin` in `app/security.py`): no header is a 401,
a wrong token a 403.

- `app/main.py`: `create_app(settings)` includes the routers and then runs the boot-time safety check
  `assert_admin_routes_guarded(app)` from `app/audit.py`. The app refuses to start when any route
  under `/admin` can be reached without `require_admin`.
- `app/routers/admin.py` mounts the admin routers under `/admin`. Guards are applied in different
  places on purpose (endpoint parameter, route `dependencies`, router `dependencies`, at
  `include_router`), depending on what each team needed.

## Development

```sh
python -m venv .venv && .venv/bin/pip install --require-hashes --no-deps -r requirements.lock
.venv/bin/python -m pytest
```

`requirements.lock` is generated from `pyproject.toml` with
`uv pip compile pyproject.toml --group dev --generate-hashes --universal --python-version 3.14 -o requirements.lock`.
