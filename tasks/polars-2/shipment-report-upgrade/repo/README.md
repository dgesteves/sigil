# shipping-reports

The nightly reports for warehouse operations: per-day volumes and weights, carrier usage, label
checks for the printers, stock across our two warehouses, tag rows for the storefront and the long
format the BI tool imports. `shipping/report.py` holds all of it; the docstrings are the contract
with the dashboard and the BI exports, which read these frames by column name.

```sh
python -m venv .venv && .venv/bin/pip install --require-hashes --no-deps -r requirements.lock
.venv/bin/python -m pytest
```

Dependencies are pinned in `pyproject.toml` and locked with hashes in `requirements.lock`
(`uv pip compile pyproject.toml --group dev --generate-hashes --universal -o requirements.lock`).
