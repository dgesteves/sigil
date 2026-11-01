# relaykit

Building blocks for the webhook relay service:

- `relaykit.cache.TTLCache`: in-memory cache for signing keys and endpoint metadata.
- `relaykit.ratelimit.TokenBucket`: async token bucket that paces deliveries per destination.
- `relaykit.retry.retry_async`: retries transient delivery failures (`ConnectionError`,
  `TimeoutError`) with capped exponential backoff and jitter; `retry_after_seconds` parses
  `Retry-After` headers.

Time-based components take optional `clock` / `sleep` / `rng` arguments; production code uses the
defaults (`time.monotonic`, `asyncio.sleep`, the `random` module).

## Development

Dependencies are pinned in `requirements.lock` (generated with
`uv pip compile pyproject.toml --group dev --generate-hashes --universal --python-version 3.14 -o requirements.lock`).

```sh
python -m venv .venv
.venv/bin/pip install --require-hashes --no-deps -r requirements.lock
.venv/bin/python -m pytest
```

Async tests use pytest-asyncio (strict mode). CI runs the suite with pytest-randomly.
