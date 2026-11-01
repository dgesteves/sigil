# helpdesk

Ticket storage and workflow for the support desk: tickets, assignment, agent comments and the open
queue. Backed by SQLite through SQLAlchemy 2.

- `helpdesk/models.py`: ORM models.
- `helpdesk/service.py`: the workflow functions. Each one commits its own unit of work and returns
  the ORM object(s) it touched.
- `helpdesk/serializers.py`: the JSON shapes the API returns, as plain functions over ORM objects.
- `helpdesk/db.py`: engine, schema and session helpers. Foreign keys are enforced (SQLite needs a
  pragma per connection for that).

## Development

```sh
python -m venv .venv
.venv/bin/pip install --require-hashes --no-deps -r requirements.lock
.venv/bin/python -m pytest
```
