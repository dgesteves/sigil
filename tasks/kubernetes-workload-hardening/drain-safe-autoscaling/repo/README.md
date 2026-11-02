# tideway-search

Full-text search over the Tideway catalogue.

| Path | What it is |
| --- | --- |
| `src/server.js` | Query API on port 8080; emits StatsD metrics to `localhost:9125` |
| `src/indexer.js` | Consumes catalogue changes and writes the search index |
| `deploy/k8s/` | Plain manifests, applied by CI with `kubectl apply -R -f deploy/k8s/` to the `search` namespace |

`search-api` runs a `statsd-exporter` next to the API container, which turns the StatsD stream
into Prometheus metrics on port 9102.

## Cluster

Production runs Kubernetes 1.37 with metrics-server. Node pools are upgraded by the cluster team's
automation, which cordons and drains nodes one at a time and gives up on a node if it cannot finish
draining it.

## Checks

```sh
npm test                        # manifest sanity checks
sh scripts/fetch-k8s-tools.sh   # once: kubeconform + Kubernetes 1.37 schemas into .tools/
npm run lint:k8s                # validate deploy/k8s against the 1.37 API
```
