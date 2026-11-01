# Troubleshooting

Deliveries failing with 401: the handler is rejecting the signature. Check that you verify
against the raw request body, not a re-serialized copy.

Deliveries timing out: raise `timeout_ms` or acknowledge first and do the work in a queue.

Nothing arrives after a deploy: confirm the endpoint printed by `relay deploy` matches the
one registered with your payment provider.
