# Sources

Checked on 2026-11-01. Current release: Kubernetes v1.37.2 (2026-10-28; v1.37.0 was released
2026-08-26), with v1.36.6, v1.35.10 and v1.34.13 as the other supported minors, from
https://dl.k8s.io/release/stable.txt and the GitHub releases of kubernetes/kubernetes.

## Kubernetes source (tag v1.37.2)

- Pod Security Admission checks, one file per control:
  https://github.com/kubernetes/kubernetes/tree/v1.37.2/staging/src/k8s.io/pod-security-admission/policy
  (`check_runAsNonRoot.go` and `check_runAsUser.go` with the 1.35 user-namespace relaxation,
  `check_restrictedVolumes.go` including `image` volumes, `check_procMount_restricted.go` (1.35),
  `check_hostProbesAndhostLifecycle.go` (1.34), `check_sysctls.go` (1.37 list),
  `check_capabilities_restricted.go`, `check_seccompProfile_restricted.go`).
- Kubelet runAsNonRoot check and image user lookup: `pkg/kubelet/kuberuntime/security_context_others.go`
  (`verifyRunAsNonRoot`), `pkg/kubelet/kuberuntime/helpers.go` (`getImageUser`).
- Lifecycle hook runner (exec, httpGet, sleep; anything else is an invalid handler):
  `pkg/kubelet/lifecycle/handlers.go`.
- PDB status computation: `pkg/controller/disruption/disruption.go` (`getExpectedPodCount`,
  `countHealthyPods`, `updatePdbStatus`).
- Eviction decisions, `unhealthyPodEvictionPolicy`, multiple-PDB refusal:
  `pkg/registry/core/pod/storage/eviction.go`.
- HPA request accounting (sidecars, pod-level requests, "missing request for cpu"):
  `pkg/controller/podautoscaler/replica_calculator.go`.
- containerd image user parsing (`getUserFromImage`, numeric vs name):
  https://github.com/containerd/containerd/blob/v2.2.0/internal/cri/server/images/image_status.go
- Removal of the seccomp annotations: CHANGELOG-1.25 (kubelet support removed) and CHANGELOG-1.27
  (completely removed, #114947): https://github.com/kubernetes/kubernetes/tree/master/CHANGELOG

## kubernetes.io documentation (kubernetes/website, main branch = 1.37 docs)

- Pod Security Standards: https://kubernetes.io/docs/concepts/security/pod-security-standards/
- Pod Security Admission and namespace labels: https://kubernetes.io/docs/concepts/security/pod-security-admission/
- Security context: https://kubernetes.io/docs/tasks/configure-pod-container/security-context/
- Seccomp tutorial (annotations no longer supported): https://kubernetes.io/docs/tutorials/security/seccomp/
- User namespaces: https://kubernetes.io/docs/concepts/workloads/pods/user-namespaces/
- Sidecar containers: https://kubernetes.io/docs/concepts/workloads/pods/sidecar-containers/
- Pod lifecycle, termination flow, 2-second preStop extension, sidecar shutdown order, container
  restart rules: https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/
- Container lifecycle hooks (sleep handler, tcpSocket deprecated):
  https://kubernetes.io/docs/concepts/containers/container-lifecycle-hooks/
- Probes: https://kubernetes.io/docs/concepts/workloads/pods/probes/ and
  https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/
- PodDisruptionBudget, unhealthy pod eviction policy, zero-disruption budgets block drains:
  https://kubernetes.io/docs/tasks/run-application/configure-pdb/ and
  https://kubernetes.io/docs/concepts/workloads/pods/disruptions/
- Horizontal Pod Autoscaling (requests on every container, ContainerResource, tolerance,
  scale to zero, removing `spec.replicas`):
  https://kubernetes.io/docs/concepts/workloads/autoscaling/horizontal-pod-autoscale/
- Topology spread constraints: https://kubernetes.io/docs/concepts/scheduling-eviction/topology-spread-constraints/
- Deprecated API migration guide: https://kubernetes.io/docs/reference/using-api/deprecation-guide/
- Feature gate stages (GA versions) from
  https://github.com/kubernetes/website/tree/main/content/en/docs/reference/command-line-tools-reference/feature-gates:
  SidecarContainers (GA 1.33), PodLifecycleSleepAction (GA 1.34), PodLifecycleSleepActionAllowZero
  (GA 1.34), PDBUnhealthyPodEvictionPolicy (GA 1.31), UserNamespacesSupport (GA 1.36),
  ProcMountType (GA 1.36), ImageVolume (GA 1.36), InPlacePodVerticalScaling (GA 1.35),
  PodLevelResources (beta, on, 1.34), HPAConfigurableTolerance (GA 1.37), HPAScaleToZero (beta, on,
  1.37), HPAContainerMetrics (GA 1.30), MatchLabelKeysInPodTopologySpread (beta, on, 1.27),
  MinDomainsInPodTopologySpread (GA 1.30), NodeInclusionPolicyInPodTopologySpread (GA 1.33),
  ContainerRestartRules (beta, on, 1.35), CronJobTimeZone (GA 1.27).

## Behaviour measured on a cluster

A throwaway single-node cluster (`rancher/k3s:v1.37.1-k3s1`, Kubernetes v1.37.1, containerd
2.3.4) run in Docker on 2026-11-01:

- 34 pod fixtures applied with `--dry-run=server` to a namespace with `enforce=restricted`,
  `enforce-version=latest`; every verdict in the pod-security reference matched the admission
  controller (including `drop: ["all"]` rejected, seccomp annotation rejected with the
  "non-functional in v1.27+" warning, `hostUsers: false` relaxation, image volumes admitted).
- A non-compliant Deployment in that namespace was created with a warning and its ReplicaSet
  failed to create pods (`FailedCreate`).
- `runAsNonRoot: true` with images whose USER is `node` (name), unset (busybox) and `0`
  (distroless `:latest`): `CreateContainerConfigError` with the messages quoted in SKILL.md;
  numeric USER or an explicit `runAsUser` started.
- preStop in `gcr.io/distroless/nodejs24-debian13:nonroot`: `sh -c sleep` and bare `node` failed
  (`FailedPreStopHook`, deletion in 1 s); `/nodejs/bin/node -e setTimeout` and `sleep: {seconds: 8}`
  delayed deletion to 9 s. The image filesystem was listed with `docker export`: the only executable
  is `/nodejs/bin/node`. Image configs read with `docker image inspect`: `:nonroot` has User
  `65532`, `:latest` has `0`; `node:24-bookworm-slim` has no User and `node` is uid 1000.
- Job with a proxy under `containers`: never completed. Same Job with the proxy as
  `restartPolicy: Always` init container: completed.
- Evictions through the eviction subresource: `minAvailable` equal to replicas refused;
  all-unready pods with `minAvailable: 2` and with `maxUnavailable: 1` (default policy) refused,
  allowed after setting `AlwaysAllow`; `maxUnavailable: 1` allowed one eviction and refused a
  second immediately after.
- `kubectl apply --dry-run=server` rejected `readOnlyRootFileSystem` (strict decoding) and an
  integer env `value`; a volume named `n` was read as a boolean.
- `kubectl label --dry-run=server ns ... enforce=restricted` listed the violating pod.

## Tools

- kubeconform v0.8.0 (2026-06-04), https://github.com/yannh/kubeconform, Apache-2.0. Release
  checksums from the release's CHECKSUMS file.
- Kubernetes JSON schemas, https://github.com/yannh/kubernetes-json-schema (Apache-2.0),
  `v1.37.2-standalone-strict` at commit e0c72a1bc5f409d1685c0e1323460c8a98cd7459.
- Cloud SQL Auth Proxy v2.27.0 (2026-10-29), image path and health-check flags from
  https://github.com/GoogleCloudPlatform/cloud-sql-proxy (README and examples/k8s-health-check).
