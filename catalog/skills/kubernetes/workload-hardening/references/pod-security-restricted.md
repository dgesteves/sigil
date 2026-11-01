# Pod Security Standards: restricted, control by control

Ported from `staging/src/k8s.io/pod-security-admission/policy` at v1.37.2 and the Pod Security
Standards page. Every verdict in the "Edge cases" section was reproduced against the admission
controller of a 1.37 cluster with `kubectl apply --dry-run=server` in a namespace labelled
`enforce=restricted, enforce-version=latest`.

"Every container" means `initContainers` (regular and sidecar), `containers` and
`ephemeralContainers`. If one container fails, the pod is rejected.

## Restricted controls (on top of baseline)

| Control | Requirement | Since |
| --- | --- | --- |
| Volume types | Each volume sets one of `configMap`, `csi`, `downwardAPI`, `emptyDir`, `ephemeral`, `image`, `persistentVolumeClaim`, `projected`, `secret` | always (`image` volumes GA in 1.36) |
| Privilege escalation | `securityContext.allowPrivilegeEscalation: false` on every container. Unset is a violation | 1.8; Linux only since 1.25 |
| Running as non-root | `runAsNonRoot: true` at pod level, or on every container. An explicit `false` anywhere fails even if the pod level says `true` | always; relaxed for `hostUsers: false` since 1.35 |
| Non-root user | `runAsUser` is never `0`, pod or container | 1.23; relaxed for `hostUsers: false` since 1.35 |
| Seccomp | `seccompProfile.type` `RuntimeDefault` or `Localhost` at pod level, or on every container. `Unconfined` anywhere fails. Absent everywhere fails | 1.19; Linux only since 1.25 |
| Capabilities | `capabilities.drop` includes `ALL` on every container; `capabilities.add` contains nothing but `NET_BIND_SERVICE` | 1.22; Linux only since 1.25 |
| `/proc` mount | `procMount` unset or `Default` (no user-namespace exception at restricted) | 1.35 |

## Baseline controls (included in restricted)

| Control | Requirement |
| --- | --- |
| Host namespaces | `hostNetwork`, `hostPID`, `hostIPC` unset or `false` |
| Privileged | `privileged` unset or `false` on every container |
| Host ports | no `ports[*].hostPort` other than `0` |
| HostPath | no `hostPath` volumes (restricted's volume list already excludes them) |
| Host probes and hooks (1.34+) | `host` unset or `""` in `httpGet`/`tcpSocket` of liveness, readiness and startup probes and of `postStart`/`preStop` handlers |
| AppArmor | `appArmorProfile.type` unset, `RuntimeDefault` or `Localhost`; annotations `container.apparmor.security.beta.kubernetes.io/*` only `runtime/default` or `localhost/*` |
| SELinux | `seLinuxOptions.type` unset, `container_t`, `container_init_t`, `container_kvm_t` or `container_engine_t` (1.31+); `user` and `role` unset |
| Sysctls | only `kernel.shm_rmid_forced`, `net.ipv4.ip_local_port_range`, `net.ipv4.ip_unprivileged_port_start`, `net.ipv4.tcp_syncookies`, `net.ipv4.ping_group_range`, `net.ipv4.ip_local_reserved_ports` (1.27), `net.ipv4.tcp_keepalive_time`, `tcp_fin_timeout`, `tcp_keepalive_intvl`, `tcp_keepalive_probes` (1.29), `tcp_rmem`, `tcp_wmem` (1.32), `tcp_slow_start_after_idle`, `tcp_notsent_lowat` (1.37) |
| Windows HostProcess | `windowsOptions.hostProcess` unset or `false` |

## Edge cases (all verified against the 1.37 admission controller)

| Pod | Verdict |
| --- | --- |
| seccomp only via `seccomp.security.alpha.kubernetes.io/pod: runtime/default` | rejected: the annotation is ignored (warning: "non-functional in v1.27+") |
| seccomp `RuntimeDefault` on the app container only, none at pod level, an init container without it | rejected |
| seccomp on every container, none at pod level | admitted |
| pod `RuntimeDefault`, one container `Unconfined` | rejected |
| `capabilities.drop: ["all"]` | rejected (comparison is case-sensitive) |
| `capabilities.add: ["NET_BIND_SERVICE"]` with drop ALL | admitted |
| `capabilities.add: ["CHOWN"]` | rejected (baseline would allow it; restricted does not) |
| pod `runAsNonRoot: true`, one container `runAsNonRoot: false` | rejected |
| `runAsNonRoot: true` on the app container only, init container without it | rejected |
| `runAsNonRoot` on every container, none at pod level | admitted |
| `hostUsers: false`, no `runAsNonRoot`, `runAsUser: 0` | admitted (user namespace) |
| `hostUsers: false`, `procMount: Unmasked` | rejected |
| a native sidecar (`restartPolicy: Always` init container) without its own security context | rejected |
| `privileged: false` set explicitly | admitted |
| `image`, `csi`, `ephemeral`, `persistentVolumeClaim`, `projected`, `downwardAPI` volumes | admitted |
| `nfs` volume | rejected |
| `spec.os.name: windows`, `runAsNonRoot: true`, no seccomp, capabilities or privilege escalation fields | admitted |
| sysctl `net.ipv4.tcp_notsent_lowat` | admitted on 1.37 |
| `readinessProbe.httpGet.host` set | rejected |
| SELinux type `spc_t` | rejected; `container_engine_t` admitted |

## How enforcement behaves

- Namespace labels: `pod-security.kubernetes.io/enforce`, `.../warn`, `.../audit`, each with an
  optional `-version` label (`latest` or `v1.37`). Pin `enforce-version` if you need upgrades not to
  tighten the policy.
- `enforce` applies to Pod creation (and to ephemeral container updates). Workload objects
  (Deployment, Job, CronJob...) are admitted with a warning; their controllers then fail to create
  pods (`FailedCreate` events) and the workload sits at 0 ready.
- Exemptions (usernames, runtime classes, namespaces) are cluster configuration, not something a
  manifest can request.
- Check a namespace before labelling it:
  `kubectl label --dry-run=server --overwrite ns NAME pod-security.kubernetes.io/enforce=restricted`
  prints one warning per violating pod.

## Things restricted does not check, but the pod still needs

- **The kubelet's image-user check** (SKILL.md Rule 2). Admission never sees the image.
- **Writable paths** under `readOnlyRootFilesystem: true`.
- **File permissions**: with a new `runAsUser`, files baked into the image are usually root-owned
  and world-readable, which is fine for reading. Directories the app writes in the image (caches,
  uploads) need to become `emptyDir` mounts or be owned by the uid. `fsGroup` changes group
  ownership of volumes, not of the image filesystem.
- **Ports below 1024**: whether a non-root process may bind them depends on the runtime and node
  configuration. Listen on a port at or above 1024 and map it in the Service (`port: 80`,
  `targetPort: 8080`) instead of relying on `NET_BIND_SERVICE`.
