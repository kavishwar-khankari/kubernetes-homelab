# Kubernetes Homelab

GitOps-managed Kubernetes homelab running on RKE2. Media streaming, automation, game servers, and infrastructure — all declared in YAML and synced via ArgoCD.

## Cluster Overview

```
                        ArgoCD (app-of-apps)
                               │
          ┌────────────────────┼────────────────────┐
          │                    │                     │
     Infrastructure       Applications        Reverse Proxy
    ┌─────┴─────┐      ┌──────┴──────┐      ┌──────┴──────┐
  MetalLB    Longhorn  Jellyfin  Arr-Stack  Proxmox  TrueNAS
  CertMgr   Tailscale  Tdarr    VPN-Torr   Immich   Nextcloud
                       Frostbite  Crafty     Dashy   Code-Server
                       Tachidesk              PBS     Router
```

## Services

### Media Stack

| Service | Purpose | Domain |
|---|---|---|
| **Jellyfin** | Media server (Intel Arc QSV) | jellyfin.techtronics.top |
| **Sonarr** | TV series management | sonarr.techtronics.top |
| **Radarr** | Movie management | radarr.techtronics.top |
| **Lidarr** | Music management | lidarr.techtronics.top |
| **Prowlarr** | Indexer manager | prowlarr.techtronics.top |
| **Jellyseerr** | Request & discovery UI | jellyseerr.techtronics.top |
| **Tdarr** | AV1 transcoding (Intel QSV) | tdarr.techtronics.top |
| **Frostbite** | Tiered storage engine (NAS/cloud) | frostbite.techtronics.top |
| **Threadfin** | TV guide provider | threadfin.techtronics.top |

### Download Stack (VPN-protected)

| Service | Purpose | Domain |
|---|---|---|
| **Gluetun** | WireGuard VPN gateway | Internal |
| **qBittorrent** | Torrent client | qbittorent.techtronics.top |
| **JDownloader** | Direct download manager | jdownloader2.techtronics.top |
| **RDTClient** | Real-Debrid download client | rdtclient.techtronics.top |
| **FlareSolverr** | Cloudflare bypass for indexers | Internal |

### Other

| Service | Purpose | Domain |
|---|---|---|
| **Crafty** | Minecraft server manager | crafty.techtronics.top |
| **Tachidesk** | Manga reader/downloader | tachi.techtronics.top |
| **Wizarr** | User invitation system | wizarr.techtronics.top |

### Reverse-Proxied Infrastructure

External services proxied through the cluster's ingress:

| Service | Type |
|---|---|
| Proxmox VE (x4) | Hypervisors |
| TrueNAS | NAS |
| Proxmox Backup Server | Backup |
| Immich | Photo library |
| Nextcloud | File sync |
| Code-Server | Web IDE |
| Dashy | Dashboard |

## Architecture

### GitOps

Everything is managed through ArgoCD using an app-of-apps pattern:

```
argo-master-app/          # Bootstrap — single app that manages all others
  master-app.yaml         # Points to argo-apps/ with automated sync
  master-project.yaml     # ArgoCD project definition

argo-apps/                # One ArgoCD Application per service
  arr-stack.yaml
  jellyfin.yaml
  tdarr.yaml
  vpn-torr.yaml
  frostbite.yaml
  ...

manifests/                # Raw K8s manifests per namespace
  arrs/
  jellyfin/
  tdarr/
  vpn-torr/
  frostbite/
  ...

helm/                     # Helm-managed apps
  ArgoCD/
  librespeed/

reverse-proxy/            # ApplicationSet — auto-discovers subdirectories
  dashy/
  immich/
  pve-1/
  truenas-2/
  ...
```

### Networking

- **Ingress**: NGINX Ingress Controller
- **Load Balancer**: MetalLB (L2 mode, pool: `192.168.0.40–70`)
- **TLS**: Let's Encrypt via cert-manager (Cloudflare DNS-01)
- **VPN**: WireGuard (Gluetun) for download stack, Tailscale for remote access
- **Domain**: `*.techtronics.top` (Cloudflare DNS)

### Storage

| Type | Use Case | Details |
|---|---|---|
| **Longhorn** | App configs, databases | Distributed block storage, 2 replicas |
| **SMB CSI** | Media library | TrueNAS share (`//192.168.0.75/media_2/media`) |
| **HostPath** | NAS mounts, transcode cache | `/mnt/nas/media`, `/mnt/merged/media` |
| **EmptyDir** | Ephemeral cache | Memory-backed (Jellyfin transcodes) |

### Media Storage Tiers

```
/mnt/merged/media  ← mergerfs union (read from both)
    ├── /mnt/nas/media      ← Hot tier (local NAS, fast)
    └── /mnt/cloud/media    ← Cold tier (OpenDrive via rclone, encrypted)
```

Frostbite automatically moves files between tiers based on playback activity. Tdarr encodes everything to AV1 before files become eligible for cold storage.

### GPU

Intel Arc (xe) shared between:
- **Jellyfin** — hardware transcoding (QSV)
- **Tdarr worker** — AV1 encoding (QSV)

### Multi-Container Pods

Several services are co-located in single pods for shared networking:

| Pod | Containers |
|---|---|
| **arr-stack** | Sonarr, Radarr, Lidarr, Jellyseerr, Wizarr, Prowlarr, FlareSolverr |
| **vpn-torr** | Gluetun, qBittorrent, JDownloader, RDTClient |
| **jellyfin** | Jellyfin, Threadfin |
| **crafty** | Crafty Controller, Tailscale sidecar |

## Tech Stack

| Component | Technology |
|---|---|
| Kubernetes | RKE2 |
| GitOps | ArgoCD |
| Ingress | NGINX Ingress Controller |
| Load Balancer | MetalLB |
| Storage | Longhorn, SMB CSI Driver |
| TLS | cert-manager + Let's Encrypt |
| VPN | WireGuard (Gluetun), Tailscale |
| Secrets | Doppler |
| DNS | Cloudflare |
| GPU | Intel Arc (QSV) |

## Node Topology

| Node | Role | Workloads |
|---|---|---|
| **GPU Node** | Compute + GPU | Jellyfin, Tdarr worker |
| **k3s-node-2** | Compute | Arr-stack, VPN-torr, Frostbite |
| **All nodes** | Network | Tailscale subnet router (DaemonSet) |
