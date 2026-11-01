# tally-api

Counts things for the Northwind dashboards.

| Endpoint | |
| --- | --- |
| `GET /healthz` | `200 {"status":"ok"}`, or `503` while the server drains on shutdown |
| `GET /v1/tallies/:name` | current count |
| `POST /v1/tallies/:name/increment?by=n` | adds `n` (default 1) |

Configuration comes from the environment: `PORT` (default 8080), `LOG_LEVEL` (default `info`) and
`SHUTDOWN_TIMEOUT_MS` (default 10000). On `SIGTERM` or `SIGINT` the server reports unhealthy, stops
accepting connections, finishes in-flight requests and exits.

## Image

```sh
docker build -t tally-api .
docker run --rm -p 8080:8080 tally-api
```

Production runs on the platform team's Kubernetes clusters with `k8s/deployment.yaml`.
