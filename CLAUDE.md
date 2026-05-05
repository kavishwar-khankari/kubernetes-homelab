# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# kubernetes-homelab

GitOps-managed RKE2 homelab synced by ArgoCD. Domain: `*.techtronics.top` (note: `techtronics`, not `techtroics`).

## Repo layout — two deployment patterns coexist

### 1. In-cluster apps (`manifests/<app>/` + `argo-apps/<app>.yaml`)

For services running natively in the k8s cluster.

- `manifests/<app>/` holds plain YAML manifests: typically `deployment.yaml`, `service.yaml`, `ingress.yaml`, `storage.yaml`, plus optional `secrets.yaml`. No Kustomize, no Helm (one-off exceptions: `helm/ArgoCD` and `helm/librespeed` — standard Helm chart layout with `templates/` holding the same flat YAML files).
- `storage.yaml` usually starts with a `Namespace` resource (belt-and-suspenders with ArgoCD's `CreateNamespace=true`), followed by PVCs and optionally static PVs for CSI-backed shares.
- `argo-apps/<app>.yaml` is a hand-written ArgoCD `Application` living in the `default` namespace. It uses `destination.namespace: <app>` and `syncOptions: [CreateNamespace=true]` to target the app namespace. All apps use `automated.prune: true` + `selfHeal: true`.
- Reference templates: `manifests/jellyfin/`, `manifests/vaultwarden/`, `manifests/frostbite/`, `argo-apps/jellyfin.yaml`.

### 2. External-service reverse proxies (`reverse-proxy/<app>/`)

For exposing a non-k8s service (Proxmox node, TrueNAS, etc.) under `<app>.techtronics.top` without running it in the cluster.

- Each folder contains `service.yaml` (ClusterIP, no selector), `endpoint.yaml` (manual `Endpoints` pointing at the external IP:port), `ingress.yaml`.
- Auto-discovered by the `reverse-proxy` ApplicationSet in `argo-apps/reverse-proxy.yaml` — adding a directory under `reverse-proxy/` is enough; no per-app Application needed. Generated app name is `rp-<dir>`, namespace is `<dir>`.

### Bootstrap

`argo-master-app/master-app.yaml` is the single Application that syncs `argo-apps/`, which in turn syncs everything else. To add an app: drop manifests in the right place, push, ArgoCD does the rest.

## Patterns

- **Multi-container pods**: co-locate tightly-coupled containers in one pod when they share networking. Examples: `jellyfin` (jellyfin + meilisearch + threadfin), `vpn-torr` (gluetun + qbittorrent + prowlarr + jdownloader2 + rdtclient + aria2 + ariang), `crafty+tailscale.yaml` (crafty + tailscale sidecar, StatefulSet).
- **Secrets**: two patterns:
  - **DopplerSecret** (preferred): `DopplerSecret` CR lives in `doppler-operator-system` namespace, references the `doppler-token-secret`, and creates a `managedSecret` in the target app namespace. The `processors` field can rename keys (e.g. `VAULTWARDEN_ADMIN_TOKEN` → `ADMIN_TOKEN`). See `manifests/vaultwarden/secrets.yaml` or `manifests/cert-manager/cloudflare-token.dopplersecret.yaml`.
  - **K8s Secret**: plain `Secret` resources, referenced via `secretKeyRef` or `envFrom[].secretRef`. See `manifests/jellyfin/meilisearch-secret.yaml`.
- **GPU workloads**: Intel Arc (xe) shared by Jellyfin and Tdarr. Request via `resources.limits["gpu.intel.com/xe"]: "1"` in the container spec.
- **Node affinity**: use `preferredDuringSchedulingIgnoredDuringExecution` targeting `kubernetes.io/hostname`. GPU workloads go to the GPU node; CPU-heavy stacks (arr-stack, vpn-torr) prefer `k3s-node-2`.
- **Sync waves**: control deploy order with `argocd.argoproj.io/sync-wave` annotation (negative = deploy first, e.g. secrets at `-1`).
- **Storage**: three patterns used:
  - **Longhorn PVCs**: for app config/data. `accessModes: [ReadWriteOnce]`, `storageClassName: longhorn`. Manual PVC in `storage.yaml`.
  - **StatefulSet volumeClaimTemplates**: for auto-provisioned Longhorn PVCs (e.g. Tdarr server's `server`, `configs`, `logs` volumes). No separate `storage.yaml` needed.
  - **SMB CSI static PV + PVC**: for NAS media shares. Static `PersistentVolume` with `csi.driver: smb.csi.k8s.io`, a unique `volumeHandle`, `volumeAttributes.source` pointing at the SMB share, and `nodeStageSecretRef` naming an SMB creds secret. Bound to a PVC via `volumeName`. See `manifests/jellyfin/storage.yaml` lines 31-69 or `manifests/arrs/storage.yaml` lines 71-110.
  - **hostPath**: for NAS media mounts with `mountPropagation: HostToContainer`. `type: Directory` for existing paths, `DirectoryOrCreate` for paths that may not exist yet.
  - **emptyDir**: for ephemeral cache (`medium: Memory` for tmpfs, or plain disk).
- **Tailscale sidecar**: for VPN access to a pod, add a `tailscale` container with `privileged: true`, `TS_USERSPACE: "false"`, and a `hostPath` tun device (`/dev/net/tun`, `type: CharDevice`). Requires a ServiceAccount + Role (secrets, events) + RoleBinding. See `manifests/crafty/crafty+tailscale.yaml` for reference.
- **Tailscale DaemonSet (subnet router)** : runs on every node via DaemonSet with `hostNetwork: true` and `dnsPolicy: ClusterFirstWithHostNet`. The `TS_HOSTNAME` is set from `spec.nodeName`, `TS_ROUTES` advertises the LAN subnet, and `--snat-subnet-routes=true` is passed via `TS_EXTRA_ARGS`. TS_AUTHKEY is injected from a DopplerSecret (`TS_AUTHKEY`). Excludes nodes labeled `minecraft-server` via `requiredDuringSchedulingIgnoredDuringExecution` with `DoesNotExist` operator. See `manifests/tailscale/ds.yaml`.
- **VPN gateway (gluetun)**: the VPN container in `vpn-torr` uses `securityContext: privileged: true` with `capabilities.add: [NET_ADMIN]`. Other containers in the same pod route traffic through it.

## Conventions

- **Ingress**: `ingressClassName: nginx`. The nginx-ingress controller is configured with `--default-ssl-certificate=kube-system/techtronics-wildcard-tls`, so ingresses **omit `tls.secretName`** and just list hosts under `tls.hosts`. cert-manager renews the wildcard via `manifests/cert-manager/wildcard-cert.yaml` (issuer: `letsencrypt-prod`). Streaming apps use annotations like `proxy-read-timeout`, `proxy-send-timeout`, `proxy-body-size`, and rate-limit controls.
- **Image pinning**: pin by SHA digest with the human-readable version tag in a trailing comment, e.g. `image: lscr.io/linuxserver/radarr@sha256:...  # 5.18.1`. Refresh digest with `docker buildx imagetools inspect <image>:<tag>`. Avoid floating tags (`:latest`).
- **Stateful workloads**: `strategy: Recreate` on Deployments backed by RWO Longhorn PVCs (a RollingUpdate would deadlock on volume attach).
- **Probes**: `httpGet` against the app's main port where possible; `tcpSocket` for apps without HTTP health endpoints. Apps with long cold-starts need a generous `startupProbe` (e.g. `failureThreshold: 150 * periodSeconds: 10` = 25 min for Jellyfin) before liveness kicks in.
- **LoadBalancer (MetalLB)** : L2 mode with an `IPAddressPool` (`lan-pool`) covering both IPv4 and IPv6 ranges. `L2Advertisement` limits announcements to nodes with `metallb-announce: "true"` label. See `manifests/metal-lb/metallb-ip-pool.yaml`.
- **Timezone**: all containers use `TZ: Asia/Kolkata`.
- **PUID/PGID**: linuxserver.io images use `PUID`/`PGID` env vars (typically `1000` or `0` for host-mounted paths).

## Utilities

- `restore-pod.yaml`: standalone pod with various tools (kubectl, velero, rclone, etc.) for cluster restore/migration tasks. Run with `kubectl apply -f restore-pod.yaml` then `kubectl exec -it restore-pod -- bash`. `.gitignore` excludes `/restore-*.yaml` so you can create variants without committing them.
- `argo-master-app/master-project.yaml`: ArgoCD `AppProject` defining permissive access (all namespaces, all resources) for all apps under `master-app`.
- `.gitignore` also excludes `/helm/**/charts/` and `/helm/**/Chart.lock` — chart dependencies are committed as `.tgz` files.
