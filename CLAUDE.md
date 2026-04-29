# kubernetes-homelab

GitOps-managed k3s homelab synced by ArgoCD. Domain: `*.techtronics.top` (note: `techtronics`, not `techtroics`).

## Repo layout — two deployment patterns coexist

### 1. In-cluster apps (`manifests/<app>/` + `argo-apps/<app>.yaml`)

For services running natively in the k8s cluster.

- `manifests/<app>/` holds plain YAML manifests: typically `deployment.yaml`, `service.yaml`, `ingress.yaml`, `storage.yaml`, plus optional `secrets.yaml`. No Kustomize, no Helm (one-off exceptions: `helm/ArgoCD`, `helm/librespeed`).
- `argo-apps/<app>.yaml` is a hand-written ArgoCD `Application` pointing at `manifests/<app>/`. Set `namespace: <app>` and `syncOptions: [CreateNamespace=true]`.
- Reference templates: `manifests/jellyfin/`, `manifests/frostbite/`, `argo-apps/jellyfin.yaml`.

### 2. External-service reverse proxies (`reverse-proxy/<app>/`)

For exposing a non-k8s service (Proxmox node, TrueNAS, etc.) under `<app>.techtronics.top` without running it in the cluster.

- Each folder contains `service.yaml` (ClusterIP, no selector), `endpoint.yaml` (manual `Endpoints` pointing at the external IP:port), `ingress.yaml`.
- Auto-discovered by the `reverse-proxy` ApplicationSet in `argo-apps/reverse-proxy.yaml` — adding a directory under `reverse-proxy/` is enough; no per-app Application needed. Generated app name is `rp-<dir>`, namespace is `<dir>`.

### Bootstrap

`argo-master-app/master-app.yaml` is the single Application that syncs `argo-apps/`, which in turn syncs everything else. To add an app: drop manifests in the right place, push, ArgoCD does the rest.

## Conventions

- **Ingress**: `ingressClassName: nginx`. The nginx-ingress controller is configured with `--default-ssl-certificate=kube-system/techtronics-wildcard-tls`, so ingresses **omit `tls.secretName`** and just list hosts under `tls.hosts`. cert-manager renews the wildcard via `manifests/cert-manager/wildcard-cert.yaml` (issuer: `letsencrypt-prod`).
- **Image pinning**: pin by SHA digest with the human-readable version tag in a trailing comment, e.g. `image: lissy93/dashy@sha256:8166...c48b  # v3.2.4`. Refresh digest with `docker buildx imagetools inspect <image>:<tag>`. Floating tags (`:latest`) are avoided.
- **Stateful workloads**: `strategy: Recreate` on Deployments backed by RWO Longhorn PVCs (a RollingUpdate would deadlock on volume attach).
- **Probes**: `httpGet` against the app's main port. Apps with long cold-starts (Vue-CLI builds, DB migrations) need a generous `startupProbe` (e.g. `failureThreshold: 18 * periodSeconds: 10` = 3 min) before liveness kicks in.

