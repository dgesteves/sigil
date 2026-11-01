# Disruption budgets, eviction, autoscaling and spreading

## How a PodDisruptionBudget is evaluated (v1.37.2 source)

The disruption controller computes, for the pods the selector matches:

| Spec | expectedCount | desiredHealthy |
| --- | --- | --- |
| `maxUnavailable: X` | scale of the owning controller (Deployment, StatefulSet, ReplicaSet, or a CRD with a scale subresource) | `expected - ceil(X)` (percent rounds up), floor 0 |
| `minAvailable: N` (integer) | number of matched pods | `N` |
| `minAvailable: "P%"` | scale of the owning controller | `ceil(P% * expected)` |

`currentHealthy` counts matched pods that are Ready, not being deleted and not just evicted.
`disruptionsAllowed = currentHealthy - desiredHealthy`, or 0 if that is negative or nothing is
expected.

The eviction API then decides per pod:

1. Pod `Pending`, `Succeeded`, `Failed` or already terminating: evicted, budget ignored.
2. More than one PDB matches the pod: refused (500, "more than one PodDisruptionBudget").
3. Pod not Ready:
   - `unhealthyPodEvictionPolicy: AlwaysAllow`: evicted, budget not consumed;
   - default `IfHealthyBudget`: evicted only if `currentHealthy >= desiredHealthy` and
     `desiredHealthy > 0`; otherwise falls through to step 4.
4. `disruptionsAllowed == 0`: refused with 429 "Cannot evict pod as it would violate the pod's
   disruption budget." `kubectl drain` retries until its timeout; node upgrade automation usually
   gives up on the node.

Consequences (all reproduced on a 1.37 cluster):

- `minAvailable` equal to the replica count (or `100%`, or `maxUnavailable: 0`): zero evictions,
  drains hang. Kubernetes documents this as permitted.
- 3 replicas all crash-looping, `minAvailable: 2` or `maxUnavailable: 1` with the default policy:
  refused. Same with `AlwaysAllow`: evicted.
- `maxUnavailable: 1`, all healthy: the first eviction succeeds, a second one right after is refused
  until the replacement is Ready.

Choosing values:

| Workload | Budget |
| --- | --- |
| Stateless, autoscaled | `maxUnavailable: 1` (or a small percentage), `AlwaysAllow` |
| Quorum (etcd, ZooKeeper, Kafka controllers) of 3 or 5 | `maxUnavailable: 1`, or `minAvailable` = quorum size |
| Single replica | No PDB, or accept that drains need a human; a PDB cannot make one replica highly available |

`AlwaysAllow` trade-off: pods of a rollout that are still starting (not Ready yet) can also be
evicted. For most stateless services that is the right trade; for stateful sets that need every
starting member to rejoin, keep `IfHealthyBudget` and alert on blocked drains.

## HorizontalPodAutoscaler (autoscaling/v2)

- **Resource utilization** is `sum(usage) / sum(requests)` over the pod's containers, including
  native sidecars. A container without a request for that resource makes the pod's utilization
  undefined: the HPA reports the metric as unknown and does not scale on it. Requests default to
  limits when only limits are set.
- **Pod-level resources** (`spec.resources`, beta and on by default since 1.34): when pod-level
  requests are set and the metric is not per-container, the HPA uses them instead of summing
  containers.
- **ContainerResource** metrics scale on one named container's usage against its own request,
  ignoring sidecars:

  ```yaml
  metrics:
    - type: ContainerResource
      containerResource:
        name: cpu
        container: web
        target: { type: Utilization, averageUtilization: 65 }
  ```

- No `metrics` means 80% average CPU utilization.
- `behavior` controls the rate: `scaleDown.stabilizationWindowSeconds` (default 300),
  `policies` (`Pods` or `Percent` per `periodSeconds`), `selectPolicy`. Since 1.37 (GA) each
  direction can also set `tolerance` (default 0.1, the old global flag).
- `minReplicas: 0` (beta, on by default since 1.37) needs at least one Object or External metric.
- autoscaling/v1 still exists (`targetCPUUtilizationPercentage`) but only knows CPU.
- Leave `spec.replicas` out of a Deployment the HPA manages. Every `kubectl apply` of a manifest
  that sets it resets the scale. Removing it from a live object: the Kubernetes docs warn that the
  default of 1 can apply once; remove it from the last-applied configuration first
  (`kubectl apply edit-last-applied`) or with server-side apply field ownership.
- HPA minimums interact with the PDB: with `maxUnavailable: 1` every replica count works; with a
  fixed `minAvailable` check both `minReplicas` and `maxReplicas`.

## Topology spread

```yaml
topologySpreadConstraints:
  - maxSkew: 1
    topologyKey: topology.kubernetes.io/zone
    whenUnsatisfiable: ScheduleAnyway
    labelSelector:
      matchLabels: { app.kubernetes.io/name: web }
    matchLabelKeys: [pod-template-hash]
  - maxSkew: 1
    topologyKey: kubernetes.io/hostname
    whenUnsatisfiable: ScheduleAnyway
    labelSelector:
      matchLabels: { app.kubernetes.io/name: web }
    matchLabelKeys: [pod-template-hash]
```

- `whenUnsatisfiable: DoNotSchedule` (the default) is a hard rule: with a zone down or out of
  capacity, new pods stay Pending. `ScheduleAnyway` is a preference.
- `labelSelector` must match the pods' own labels; it counts existing pods in each domain.
- `matchLabelKeys: [pod-template-hash]` (beta, on by default since 1.27) spreads each Deployment
  revision on its own, so a rollout is balanced too. It cannot repeat a key used in `labelSelector`.
- `minDomains` (GA 1.30) only works with `DoNotSchedule`; `nodeAffinityPolicy` and
  `nodeTaintsPolicy` (GA 1.33) decide whether nodes excluded by affinity or taints count as domains.
- One constraint per `topologyKey` + `whenUnsatisfiable` pair.

## Resources

- Requests drive scheduling, HPA utilization and eviction ranking under node pressure. Set them on
  every container, sidecars included.
- In-place resize of CPU and memory (`resize` subresource) is GA since 1.35; changing
  `resources` in a Deployment template still rolls the pods.
