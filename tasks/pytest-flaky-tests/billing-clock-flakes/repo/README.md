# billing

Date rules for subscriptions: 14-day trials, monthly renewals anchored to the start date (clamped to
the end of shorter months), the "due in 3 days" labels on invoices, and the 09:00 local-time reminder
emails.

Billing runs in UTC: every function that needs the current time defaults to UTC (`utc_now()`,
`utc_today()`) and takes an explicit `now` or `today` argument for evaluating the rule at another
instant. Reminders are the only place a customer's own timezone matters.

## Development

Dependencies are pinned in `requirements.lock` (generated with
`uv pip compile pyproject.toml --group dev --generate-hashes --universal --python-version 3.14 -o requirements.lock`).

```sh
python -m venv .venv
.venv/bin/pip install --require-hashes --no-deps -r requirements.lock
.venv/bin/python -m pytest
```

CI runs the suite with pytest-randomly. time-machine is available for tests that need to control the
clock.
