# parcelhub

Shipping-label API and the worker that renders labels. Node 24, no framework.

| Path | What it is |
| --- | --- |
| `src/server.js` | HTTP API on port 8080 (`/healthz`, `/readyz`, `POST /labels`) |
| `src/worker.js` | Queue consumer that renders labels for batch shipments |
| `src/cleanup.js` | Nightly job that expires old labels |
| `src/migrate.js` | Schema migrations, run as an init step before the API starts |
| `src/labels.js` | Label renderer: writes each PDF to a temporary file under `os.tmpdir()`, then uploads it |
| `deploy/k8s/` | Plain manifests. CI applies them with `kubectl apply -R -f deploy/k8s/` to the `parcelhub` namespace |

## Images

CI builds `ghcr.io/parcelhub/parcelhub:<version>` from the `Dockerfile`; every container that runs
our code uses that image. `wait-for-db` uses the pinned upstream busybox image.

## TLS to carriers

Carrier APIs are reached through the corporate egress proxy, which re-signs TLS with the corporate
root CA. Node trusts it through `NODE_EXTRA_CA_CERTS`. The CA used to be copied onto every node by
the platform team; they now publish it as the `corp-root-ca` ConfigMap (key `ca.crt`) in every
namespace instead.

## Checks

```sh
npm test                        # unit tests and manifest sanity checks
sh scripts/fetch-k8s-tools.sh   # once: kubeconform + Kubernetes 1.37 schemas into .tools/
npm run lint:k8s                # validate deploy/k8s against the 1.37 API
```

The database credentials live in the `parcelhub-db` Secret, which External Secrets manages; it is
not in this repo.
