# ledger-api

Read API over the Ledgerline double-entry ledger: balances, entries and CSV exports.

| Path | What it is |
| --- | --- |
| `src/server.js` | HTTP API on port 8080 |
| `src/ledger.js` | Data access (in-memory fixture here; Postgres in production) |
| `deploy/k8s/` | Plain manifests, applied by CI with `kubectl apply -R -f deploy/k8s/` to the `ledger` namespace |

Endpoints: `GET /healthz`, `GET /readyz`, `GET /accounts/:id/balance`, `GET /accounts/:id/export`
(streams the account's entries as CSV; big accounts take up to 45 seconds).

## Image

CI builds `ghcr.io/ledgerline/ledger-api:<version>` from the `Dockerfile`. The runtime stage is
distroless (`gcr.io/distroless/nodejs24-debian13:nonroot`) by security policy, and the Dockerfile
is owned by the platform security team. Use `kubectl debug` with an ephemeral container if you need
tools inside a running pod.

## Traffic

Production runs Kubernetes 1.37. Requests arrive through ingress-nginx (`deploy/k8s/ingress.yaml`);
service-to-service calls go through the `ledger-api` Service and kube-proxy.

## Checks

```sh
npm test                        # unit tests and manifest sanity checks
sh scripts/fetch-k8s-tools.sh   # once: kubeconform + Kubernetes 1.37 schemas into .tools/
npm run lint:k8s                # validate deploy/k8s against the 1.37 API
```
