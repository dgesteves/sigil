# Native sidecars and Jobs

Native sidecars are init containers with `restartPolicy: Always` (feature `SidecarContainers`: on by
default since 1.29, GA in 1.33). They:

- start in `initContainers` order; the next init container (and finally the main containers) starts
  once the sidecar is *started*: its process is running, or its `startupProbe` passed;
- keep running for the life of the pod and are restarted if they exit, whatever the pod's
  `restartPolicy`;
- do not block Job completion: once the main containers finish, the kubelet stops the sidecars and
  the pod reaches `Succeeded` or `Failed` based on the main containers;
- are stopped after the main containers at pod termination, in reverse order;
- may have liveness, readiness and startup probes (regular init containers may not); a sidecar's
  readiness counts towards the pod's Ready condition;
- count towards the pod's resource requests as long-running containers (summed with the app
  containers), and towards HPA utilization.

## Job with a database proxy

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: reindex
spec:
  backoffLimit: 2
  activeDeadlineSeconds: 3600
  template:
    spec:
      restartPolicy: Never
      initContainers:
        - name: db-proxy
          image: gcr.io/cloud-sql-connectors/cloud-sql-proxy:2.27.0
          # The proxy listens on localhost:5432 for the app; its health endpoints listen on the
          # pod IP because the kubelet probes the pod IP, not localhost.
          args: ["--port=5432", "--health-check", "--http-address=0.0.0.0", "--http-port=9801", "my-project:europe-west1:main"]
          restartPolicy: Always
          startupProbe:
            httpGet: { path: /startup, port: 9801 }
            periodSeconds: 1
            failureThreshold: 60
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities: { drop: ["ALL"] }
      containers:
        - name: reindex
          image: registry.example.com/search-tools:3.1.0
          args: ["reindex", "--all"]
```

Measured on Kubernetes 1.37: the same Job with the proxy under `containers` stayed `Running` with
`1/2` ready indefinitely after the main container exited 0; as a native sidecar it reached
`Complete`. The sidecar in that test ignored SIGTERM (a shell `sleep` as PID 1), so completion
waited for the 30 s grace period before SIGKILL: give sidecars that do not handle SIGTERM a short
`terminationGracePeriodSeconds` on the pod, or use images that exit on SIGTERM.

## Workarounds you can delete

Before native sidecars, Jobs used: `shareProcessNamespace: true` plus `pkill` from the main
container, a shared `emptyDir` "done" file the sidecar's wrapper script polls, or proxy admin
endpoints such as Cloud SQL Proxy's `--quitquitquit`. On 1.29+ clusters replace them with
`restartPolicy: Always` init containers; they needed a shell or extra tooling in the images and
broke whenever the main container crashed before signalling.

## CronJobs

Same template (`spec.jobTemplate.spec.template`). Set `concurrencyPolicy: Forbid` when runs must not
overlap, `startingDeadlineSeconds` for catch-up behaviour, and `timeZone` (GA since 1.27) instead of
assuming the controller's zone. `batch/v1beta1` CronJob is gone since 1.25.

## Restart rules for regular containers

`ContainerRestartRules` (beta, on by default since 1.35) lets app containers and regular init
containers set their own `restartPolicy` and `restartPolicyRules` (action `Restart` on matching
`exitCodes`), for example restarting one container in place on exit code 42 inside a
`restartPolicy: Never` pod. `restartPolicyRules` requires a container `restartPolicy`. It is not a
sidecar mechanism; sidecars are `initContainers` with `restartPolicy: Always`.
