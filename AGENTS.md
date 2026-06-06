# AGENTS.md — kubernetes-homelab

GitOps-managed RKE2 homelab synced by ArgoCD. Domain: `*.techtronics.top` (note: `techtronics`, not `techtroics`).

## Watch for
- Domain: `*.techtronics.top`
- Ingress: omit `tls.secretName` (nginx-ingress uses default wildcard cert)
- RWO volumes + Deployment: `strategy: Recreate` (RollingUpdate deadlocks)
- Multi-container pods: co-locate tightly-coupled containers (shared networking)
- DopplerSecret: lives in `doppler-operator-system` namespace; `managedSecret` goes to target namespace
- Storage: Longhorn PVC (RWO), SMB CSI static PV+PVC (RWX), hostPath (with `mountPropagation: HostToContainer`), StatefulSet `volumeClaimTemplates`

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

## Bootstrap

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
- **Tailscale DaemonSet (subnet router)**: runs on every node via DaemonSet with `hostNetwork: true` and `dnsPolicy: ClusterFirstWithHostNet`. The `TS_HOSTNAME` is set from `spec.nodeName`, `TS_ROUTES` advertises the LAN subnet, and `--snat-subnet-routes=true` is passed via `TS_EXTRA_ARGS`. TS_AUTHKEY is injected from a DopplerSecret (`TS_AUTHKEY`). Excludes nodes labeled `minecraft-server` via `requiredDuringSchedulingIgnoredDuringExecution` with `DoesNotExist` operator. See `manifests/tailscale/ds.yaml`.
- **VPN gateway (gluetun)**: the VPN container in `vpn-torr` uses `securityContext: privileged: true` with `capabilities.add: [NET_ADMIN]`. Other containers in the same pod route traffic through it.

## Conventions

- **Ingress**: `ingressClassName: nginx`. The nginx-ingress controller is configured with `--default-ssl-certificate=kube-system/techtronics-wildcard-tls`, so ingresses **omit `tls.secretName`** and just list hosts under `tls.hosts`. cert-manager renews the wildcard via `manifests/cert-manager/wildcard-cert.yaml` (issuer: `letsencrypt-prod`). Streaming apps use annotations like `proxy-read-timeout`, `proxy-send-timeout`, `proxy-body-size`, and rate-limit controls.
- **Image pinning**: pin by SHA digest with the human-readable version tag in a trailing comment, e.g. `image: lscr.io/linuxserver/radarr@sha256:...  # 5.18.1`. Refresh digest with `docker buildx imagetools inspect <image>:<tag>`. Avoid floating tags (`:latest`).
- **Stateful workloads**: `strategy: Recreate` on Deployments backed by RWO Longhorn PVCs (a RollingUpdate would deadlock on volume attach).
- **Probes**: `httpGet` against the app's main port where possible; `tcpSocket` for apps without HTTP health endpoints. Apps with long cold-starts need a generous `startupProbe` (e.g. `failureThreshold: 150 * periodSeconds: 10` = 25 min for Jellyfin) before liveness kicks in.
- **LoadBalancer (MetalLB)**: L2 mode with an `IPAddressPool` (`lan-pool`) covering both IPv4 and IPv6 ranges. `L2Advertisement` limits announcements to nodes with `metallb-announce: "true"` label. See `manifests/metal-lb/metallb-ip-pool.yaml`.
- **Timezone**: all containers use `TZ: Asia/Kolkata`.
- **PUID/PGID**: linuxserver.io images use `PUID`/`PGID` env vars (typically `1000` or `0` for host-mounted paths).

## Utilities

- `restore-pod.yaml`: standalone pod with various tools (kubectl, velero, rclone, etc.) for cluster restore/migration tasks. Run with `kubectl apply -f restore-pod.yaml` then `kubectl exec -it restore-pod -- bash`. `.gitignore` excludes `/restore-*.yaml` so you can create variants without committing them.
- `argo-master-app/master-project.yaml`: ArgoCD `AppProject` defining permissive access (all namespaces, all resources) for all apps under `master-app`.
- `.gitignore` also excludes `/helm/**/charts/` and `/helm/**/Chart.lock` — chart dependencies are committed as `.tgz` files.

## Homepage

When a new service is deployed, add it to the homepage dashboard (`manifests/homepage/configmap.yaml`). Search the web for whether homepage has a native widget for the service — check `https://gethomepage.dev/widgets/` and the dashboard-icons repo. If a widget exists, hook it up with the relevant API keys/tokens from Doppler secrets (`manifests/homepage/secrets.yaml`). If no native widget exists, check if the service exposes a JSON health/status endpoint and use the `customapi` widget as a fallback. At minimum, add a basic service entry with `href` and `icon`.

## General principles

- **GitOps only**: All cluster state changes must go through git. ArgoCD syncs the desired state from this repo. Never run `kubectl patch`, `kubectl edit`, `helm upgrade`, or any other imperative command against the live cluster unless it is a documented one-time operational necessity (e.g. resizing a StatefulSet PVC that ArgoCD/Helm cannot resize). If an imperative command is run, flag it and ensure the equivalent change is committed to git.
- **Research before acting**: Before making any change — whether to a file, a cluster resource, or a config value — research and understand the real-world consequences. Trace the full chain of downstream effects: will this trigger a replica reschedule? will a node become unschedulable? will a pod restart? will Longhorn admission webhooks reject it? Check live state first, do the math, verify your assumptions against actual data. If there is any uncertainty, present the analysis and ask before touching anything.

## Incidents

Documented in [`incidents/`](./incidents/). Read the [`README.md`](./incidents/README.md) index first, then the relevant incident file.

When you solve an incident:
1. Create a new `incidents/<NNN>-<slug>.md` using the next available number (check `README.md` for the last used).
2. Follow the structure in [`001-longhorn-mount-failures.md`](./incidents/001-longhorn-mount-failures.md) (Date, Symptoms, Affected, Root Cause, Fix Steps, Prevention).
3. If the incident is a recurrence or variation of a previous one, update the existing incident file with the new details instead of creating a new one.
4. Append a row to the index table in `incidents/README.md`.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- ALWAYS read graphify-out/GRAPH_REPORT.md before reading any source files, running grep/glob searches, or answering codebase questions. The graph is your primary map of the codebase.
- IF graphify-out/wiki/index.md EXISTS, navigate it instead of reading raw files
- For cross-module "how does X relate to Y" questions, prefer `graphify query "<question>"`, `graphify path "<A>" "<B>"`, or `graphify explain "<concept>"` over grep — these traverse the graph's EXTRACTED + INFERRED edges instead of scanning files
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

## Web search

Always delegate web searches to the `websearch` subagent via the Task tool. Example: "search the web for X and return the results". The `websearch` subagent uses the cheap `deepseek/deepseek-v4-flash` model with SearXNG MCP tools for normal web research, BrowserMCP in connected Chrome when SearXNG is blocked or insufficient, and BrowserMCP first for Reddit. Never use the built-in `WebSearch` or `WebFetch` tools directly.

## Reading Reddit threads

Use the `websearch` subagent for Reddit research. It should use BrowserMCP in connected Chrome for Reddit search, subreddit browsing, and thread reading.

For non-Reddit sites, the `websearch` subagent should try SearXNG first. If SearXNG cannot access or adequately read a site because of 401/403/429 errors, bot checks, CAPTCHA, Cloudflare, login/session requirements, heavy JavaScript rendering, missing page content, or required interaction, it should switch to BrowserMCP in connected Chrome and report the visible state if blocked.

Do not rely on direct `www.reddit.com`, `old.reddit.com`, `.json` fetches, or Reddit MCP for Reddit by default. If BrowserMCP cannot access Reddit, report the exact visible failure/login/CAPTCHA/rate-limit state and ask the user to connect Chrome or handle the gate in the browser.
