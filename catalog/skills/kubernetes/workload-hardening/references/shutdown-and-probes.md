# Shutdown sequence, preStop hooks and probes

## What happens when a pod terminates

1. The pod gets a deletion timestamp and grace period (`terminationGracePeriodSeconds`, default 30).
2. In parallel:
   - the EndpointSlice controller marks the pod's endpoints `terminating` (`ready: false`,
     `serving` still reflects readiness). Ingress controllers, kube-proxy on every node and cloud
     load balancers pick that up after their own propagation delay, typically seconds;
   - the kubelet runs each container's `preStop` hook **to completion**, then sends SIGTERM to the
     container's PID 1.
3. When the grace period expires, remaining processes get SIGKILL. A preStop hook still running
   at the deadline gets one 2-second extension.

The grace period is one budget for hook + SIGTERM handling, counted from the deletion request:

```
terminationGracePeriodSeconds >= preStop delay + app drain delay + longest in-flight request (+ headroom)
```

Example: 10 s preStop sleep, the app closes its listener on SIGTERM and waits for in-flight work,
the longest request is 45 s: the grace period must be at least 55 s; use 60-65.

## preStop handlers and where they run

| Handler | Runs in | Needs in the image | Notes |
| --- | --- | --- | --- |
| `sleep: {seconds: N}` | kubelet | nothing | GA 1.34. `0` allowed since 1.34. Does not count as a failure. |
| `exec: {command: [...]}` | the container (via the runtime) | the executable at an absolute path or in the container's `PATH` | A missing binary fails at once: `FailedPreStopHook`, then SIGTERM immediately. Resources count against the container. |
| `httpGet` | kubelet, to the pod IP | an endpoint in the app | The kubelet waits for the response; the status code is not checked. Never set `host`. |
| `tcpSocket` | not run | | Deprecated; the kubelet logs an invalid handler. |

Images without a shell: distroless (`gcr.io/distroless/*`), `scratch`, Chainguard/Wolfi static
images, Ubuntu chiseled images. In `gcr.io/distroless/nodejs24-debian13`
the only executable is `/nodejs/bin/node`; the PATH directories are empty, so `["node", ...]` fails
and `["/nodejs/bin/node", ...]` works. Measured on Kubernetes 1.37 (k3s, containerd 2.3):

| preStop in a distroless Node container | Pod deletion took | Event |
| --- | --- | --- |
| `exec: ["sh", "-c", "sleep 8"]` | 1 s | `FailedPreStopHook` |
| `exec: ["node", "-e", "setTimeout(() => {}, 8000)"]` | 1 s | `FailedPreStopHook` |
| `exec: ["/nodejs/bin/node", "-e", "setTimeout(() => {}, 8000)"]` | 9 s | none |
| `sleep: {seconds: 8}` | 9 s | none |

## Delaying in the app instead

Equally valid: on SIGTERM keep accepting for N seconds, then stop accepting, finish in-flight
requests and exit. Rules for the handler:

- Do not call `process.exit()` (or equivalent) before in-flight requests finish.
- After closing the listener, close idle keep-alive connections, or the process waits for their
  keep-alive timeout (Node 19+ `server.close()` closes idle ones itself).
- Exit on its own; a process that never exits turns every shutdown into a SIGKILL at the deadline.
- Make sure the app receives the signal: SIGTERM goes to PID 1, and a shell wrapper
  (`sh -c "node server.js"`) may not forward it. Use exec-form `CMD`/`command` arrays, or an init
  such as `tini`.

Failing readiness on SIGTERM is not needed for Service traffic: terminating endpoints are already
excluded from normal load balancing. It does not hurt either.

## Sidecars during termination

Native sidecars (`initContainers` with `restartPolicy: Always`) get SIGTERM only after every main
container has exited, in reverse order of declaration. A proxy sidecar therefore keeps working
while the app drains. Regular containers are signalled at the same time in arbitrary order, so a
proxy listed under `containers` may exit before the app finishes. A sidecar's own exit code at
termination is not meaningful.

## Probes

| Probe | Question it answers | On failure | Should check |
| --- | --- | --- | --- |
| startupProbe | has it finished starting? | restart after `failureThreshold * periodSeconds` | same endpoint as liveness, long budget |
| livenessProbe | is the process wedged? | container restart | the process only (event loop, deadlock) |
| readinessProbe | can it take traffic now? | removed from endpoints, no restart | dependencies it cannot serve without |

- Liveness and readiness do not run until the startup probe succeeds; with no startup probe,
  `initialDelaySeconds` is the blunt alternative.
- A liveness endpoint that checks the database, a cache or another service restarts every replica
  when that dependency blips. Kubernetes' own guidance: the liveness probe passes when the app
  itself is healthy; the readiness probe additionally checks required back-ends.
- `successThreshold` must be 1 for liveness and startup.
- Readiness probes on native sidecars count towards the pod's Ready condition.
- Probe-level `terminationGracePeriodSeconds` (stable since 1.28) shortens the kill delay after a
  liveness failure without shortening normal shutdowns.
- `exec` probes fork a process every period and need the binary in the image; prefer `httpGet`,
  `tcpSocket` or `grpc`.
