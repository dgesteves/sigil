# API versions, deprecated annotations and validation

## Served on a 1.37 cluster with default settings

`kubectl api-versions` on 1.37: `v1`, `admissionregistration.k8s.io/v1`, `apiextensions.k8s.io/v1`,
`apiregistration.k8s.io/v1`, `apps/v1`, `authentication.k8s.io/v1`, `authorization.k8s.io/v1`,
`autoscaling/v1`, `autoscaling/v2`, `batch/v1`, `certificates.k8s.io/v1`, `coordination.k8s.io/v1`,
`discovery.k8s.io/v1`, `events.k8s.io/v1`, `flowcontrol.apiserver.k8s.io/v1`, `networking.k8s.io/v1`,
`node.k8s.io/v1`, `policy/v1`, `rbac.authorization.k8s.io/v1`, `resource.k8s.io/v1`,
`scheduling.k8s.io/v1`, `storage.k8s.io/v1`, `storagemigration.k8s.io/v1`.

## Removed versions that still appear in examples

| Kind | Removed version | Removed in | Use | Notable change |
| --- | --- | --- | --- | --- |
| PodDisruptionBudget | `policy/v1beta1` | 1.25 | `policy/v1` | empty `selector: {}` now selects every pod in the namespace (it selected none) |
| PodSecurityPolicy | `policy/v1beta1` | 1.25 | Pod Security Admission labels | no replacement object |
| CronJob | `batch/v1beta1` | 1.25 | `batch/v1` | |
| HorizontalPodAutoscaler | `autoscaling/v2beta1` | 1.25 | `autoscaling/v2` | `targetAverageUtilization` became `target: {type: Utilization, averageUtilization}` |
| HorizontalPodAutoscaler | `autoscaling/v2beta2` | 1.26 | `autoscaling/v2` | |
| EndpointSlice | `discovery.k8s.io/v1beta1` | 1.25 | `discovery.k8s.io/v1` | |
| Ingress | `extensions/v1beta1`, `networking.k8s.io/v1beta1` | 1.22 | `networking.k8s.io/v1` | `pathType` required, `backend.service.name/port` |
| Deployment, DaemonSet, ReplicaSet, StatefulSet | `extensions/v1beta1`, `apps/v1beta1`, `apps/v1beta2` | 1.16 | `apps/v1` | `spec.selector` required and immutable |
| FlowSchema, PriorityLevelConfiguration | `flowcontrol.apiserver.k8s.io/v1beta3` | 1.32 | `.../v1` | |

## Annotations that no longer do anything

| Annotation | Status | Field |
| --- | --- | --- |
| `seccomp.security.alpha.kubernetes.io/pod`, `container.seccomp.security.alpha.kubernetes.io/<name>` | kubelet stopped honouring them in 1.25; fully removed in 1.27. The API server warns "non-functional in v1.27+" | `securityContext.seccompProfile` |
| `container.apparmor.security.beta.kubernetes.io/<name>` | deprecated since 1.30 (fields GA); still evaluated by PSA baseline | `securityContext.appArmorProfile` |

## YAML gotchas

Kubernetes parses manifests with YAML 1.1 rules (sigs.k8s.io/yaml): `y`, `n`, `yes`, `no`, `on`,
`off`, `true`, `false` are booleans, `0644` is octal (420), `1.10` is the float 1.1. Quote them where
a string is expected: label values, env values (`value: "true"`), annotation values, names. A volume
named `n` fails with "cannot unmarshal bool into Go struct field Volume.spec.volumes.name".
Env `value` and annotation values must be strings: `value: 8080` is rejected.

## Validating offline

kubeconform with strict schemas for the target version catches unknown fields (`readOnlyRootFileSystem`,
`terminationGracePeriod`), wrong types and removed `apiVersion`s (reported as "could not find
schema"):

```sh
kubeconform -strict -summary -kubernetes-version 1.37.2 deploy/
# or, with schemas vendored or downloaded ahead of time:
kubeconform -strict -summary \
  -schema-location 'schemas/{{ .ResourceKind }}{{ .KindSuffix }}.json' deploy/
```

The default schema source is `yannh/kubernetes-json-schema` (generated from the Kubernetes OpenAPI
spec; directories like `v1.37.2-standalone-strict`). Custom resources need their own schemas or
`-ignore-missing-schemas`, which also hides removed built-in versions, so prefer `-skip` with the
specific CRD kinds.

Schema validation does not run admission: it will not catch PSA violations, the kubelet's image
user check, or a preStop exec whose binary is missing. Against a cluster:

```sh
kubectl apply --dry-run=server -f deploy/          # strict field validation is the default
kubectl label --dry-run=server --overwrite ns NAME \
  pod-security.kubernetes.io/enforce=restricted    # warns per existing violating pod
```

Only Pod objects are enforced by PSA, so dry-run a Pod built from the template (or read the
warnings that `kubectl apply` prints for Deployments, Jobs and CronJobs in that namespace). Unknown
fields fail server-side with "strict decoding error: unknown field ...".
