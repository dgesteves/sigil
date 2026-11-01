# billing

Invoices, payments and the receivables report for the finance team.

- `billing/models.py`: ORM models for customers, invoices and invoice lines, plus the Core
  `payments` table that the bank feed importer writes to.
- `billing/invoices.py`: invoice lifecycle (ORM sessions).
- `billing/payments.py`: payments and receivables queries (Core, on an Engine).
- `billing/db.py`: engine, schema and session helpers. SQLite in every environment; foreign keys
  are enforced.

`tests/` covers the read side (summaries, payment listings, the receivables report) against a
database seeded with plain `sqlite3`, so the tests don't depend on SQLAlchemy APIs.

## Development

```sh
python -m venv .venv
.venv/bin/pip install --require-hashes --no-deps -r requirements.lock
.venv/bin/python -m pytest
```
