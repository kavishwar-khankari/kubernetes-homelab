# Graph Report - .  (2026-05-11)

## Corpus Check
- Corpus is ~29,938 words - fits in a single context window. You may not need a graph.

## Summary
- 200 nodes · 261 edges · 18 communities (11 shown, 7 thin omitted)
- Extraction: 66% EXTRACTED · 34% INFERRED · 0% AMBIGUOUS · INFERRED: 89 edges (avg confidence: 0.84)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Reverse-Proxy External Services|Reverse-Proxy External Services]]
- [[_COMMUNITY_Infrastructure Manifests (arrsjellyfincraftylonghorn)|Infrastructure Manifests (arrs/jellyfin/crafty/longhorn)]]
- [[_COMMUNITY_ArgoCD Application Definitions|ArgoCD Application Definitions]]
- [[_COMMUNITY_Application Manifests (WebUISearXNGVaultwardenTachidesk)|Application Manifests (WebUI/SearXNG/Vaultwarden/Tachidesk)]]
- [[_COMMUNITY_Storage & Deployment Patterns|Storage & Deployment Patterns]]
- [[_COMMUNITY_Tdarr & VPN Torrent Stack|Tdarr & VPN Torrent Stack]]
- [[_COMMUNITY_Monitoring Stack Helm Config|Monitoring Stack Helm Config]]
- [[_COMMUNITY_MinecraftCrafty & MetalLB|Minecraft/Crafty & MetalLB]]
- [[_COMMUNITY_Reverse-Proxy Pattern (External Backends)|Reverse-Proxy Pattern (External Backends)]]
- [[_COMMUNITY_Documentation & Bootstrap|Documentation & Bootstrap]]
- [[_COMMUNITY_SMB Shared Storage|SMB Shared Storage]]
- [[_COMMUNITY_TLS Certificate Management|TLS Certificate Management]]
- [[_COMMUNITY_Monitoring Telemetry Pipeline|Monitoring Telemetry Pipeline]]
- [[_COMMUNITY_Helm Multi-Source Deploy Pattern|Helm Multi-Source Deploy Pattern]]
- [[_COMMUNITY_arr-stack Namespace Co-location|arr-stack Namespace Co-location]]
- [[_COMMUNITY_cert-manager ACME TLS|cert-manager ACME TLS]]
- [[_COMMUNITY_MetalLB L2 Load Balancer|MetalLB L2 Load Balancer]]
- [[_COMMUNITY_Tailscale Subnet Router|Tailscale Subnet Router]]

## God Nodes (most connected - your core abstractions)
1. `ArgoCD Master Project` - 27 edges
2. `Longhorn distributed block storage` - 13 edges
3. `VPN Torrent Multi-Container Deployment` - 12 edges
4. `Monitoring & Observability Design Conversation` - 10 edges
5. `arr-stack Deployment` - 10 edges
6. `CLAUDE.md â€” Repo Conventions & Patterns` - 9 edges
7. `minecraft-server StatefulSet` - 7 edges
8. `jellyfin Deployment` - 7 edges
9. `Open WebUI Ingress` - 7 edges
10. `Gluetun VPN Proxy Container` - 7 edges

## Surprising Connections (you probably didn't know these)
- `README.md â€” Homelab Overview` --semantically_similar_to--> `CLAUDE.md â€” Repo Conventions & Patterns`  [INFERRED] [semantically similar]
  README.md → CLAUDE.md
- `CLAUDE.md â€” Repo Conventions & Patterns` --references--> `LibreSpeed Helm Chart`  [EXTRACTED]
  CLAUDE.md → helm/librespeed/Chart.yaml
- `AGENTS.md â€” Agent Instructions` --references--> `CLAUDE.md â€” Repo Conventions & Patterns`  [EXTRACTED]
  AGENTS.md → CLAUDE.md
- `CLAUDE.md â€” Repo Conventions & Patterns` --references--> `restore-pod.yaml â€” Standalone Restore Pod`  [EXTRACTED]
  CLAUDE.md → restore-pod.yaml
- `CLAUDE.md â€” Repo Conventions & Patterns` --references--> `Incidents Index`  [EXTRACTED]
  CLAUDE.md → incidents/README.md

## Hyperedges (group relationships)
- **Monitoring Stack Components and Data Flow** — monitoring_alloy_metrics, monitoring_alloy_logs, monitoring_mimir, monitoring_loki, monitoring_grafana, monitoring_ksm, monitoring_node_exporter [INFERRED 0.90]
- **ArgoCD App-of-Apps Bootstrap Chain** — master_app, master_project, argocd_helm_chart [EXTRACTED 1.00]
- **Incident Documentation Pattern** — incidents_readme, incident_001, claude_md [EXTRACTED 1.00]
- **Monitoring Telemetry Pipeline** — argoapps_monitoring_minio, argoapps_monitoring_loki, argoapps_monitoring_mimir, argoapps_monitoring_alloy_logs, argoapps_monitoring_alloy_metrics, argoapps_monitoring_grafana, argoapps_monitoring_kube_state_metrics, argoapps_monitoring_node_exporter [INFERRED 0.85]
- **arr-stack Namespace Co-located Apps** — argoapps_arr_stack, argoapps_tailscale, argoapps_tdarr [EXTRACTED 0.90]
- **Helm Multi-Source Deploy Pattern** — argoapps_monitoring_alloy_logs, argoapps_monitoring_alloy_metrics, argoapps_monitoring_grafana, argoapps_monitoring_kube_state_metrics, argoapps_monitoring_loki, argoapps_monitoring_mimir, argoapps_monitoring_node_exporter [EXTRACTED 1.00]
- **arr-stack 6-container pod** — arr-stack_radarr, arr-stack_sonarr, arr-stack_lidarr, arr-stack_wizarr, arr-stack_jellyseerr, arr-stack_flaresolverr, arr-stack_deployment [EXTRACTED 1.00]
- **Jellyfin + Meilisearch + Threadfin streaming stack** — jellyfin_container, jellyfin_meilisearch, jellyfin_threadfin, jellyfin_deployment [EXTRACTED 1.00]
- **SMB CSI shares from 192.168.0.75** — arr-stack_smb-pv, jellyfin_smb-pv, minio_smb-pv, infra_smb-csi [INFERRED 0.90]
- **VPN-Isolated Torrent Stack (gluetun + qBittorrent + Prowlarr + JDownloader2 + RDTClient + Aria2 + AriaNg)** — vpn_torr_gluetun, vpn_torr_qbittorrent, vpn_torr_prowlarr, vpn_torr_jdownloader2, vpn_torr_rdtclient, vpn_torr_aria2, vpn_torr_ariang, vpn_torr_deployment [EXTRACTED 1.00]
- **Tdarr Server-Worker Architecture (server StatefulSet + worker Deployment + shared media)** — tdarr_server_statefulset, tdarr_worker_deployment, tdarr_headless_service, tdarr_media_storage, tdarr_lb_service [EXTRACTED 1.00]
- **Open WebUI SearXNG Web Search Pipeline** — openwebui_deployment, searxng_service, searxng_deployment, searxng_configmap [EXTRACTED 1.00]
- **code-server Reverse-Proxy Triad** — reverse_proxy_code_server_endpoint, reverse_proxy_code_server_service, reverse_proxy_code_server_ingress [EXTRACTED 1.00]
- **files-2 Reverse-Proxy Triad** — reverse_proxy_files2_endpoint, reverse_proxy_files2_service, reverse_proxy_files2_ingress [EXTRACTED 1.00]
- **immich Reverse-Proxy Triad** — reverse_proxy_immich_endpoint, reverse_proxy_immich_service, reverse_proxy_immich_ingress [EXTRACTED 1.00]
- **Reverse Proxy External Services** — pve-2, pve-3, pve-4, router, speed, truenas-2, ubuntu-server-1, ubuntu-server-2 [INFERRED 0.90]

## Communities (18 total, 7 thin omitted)

### Community 0 - "Reverse-Proxy External Services"
Cohesion: 0.09
Nodes (39): code-server Endpoints, code-server Ingress, code-server Service, files-2 Endpoints, files-2 Ingress, files-2 Service, immich Endpoints, immich Ingress (+31 more)

### Community 1 - "Infrastructure Manifests (arrs/jellyfin/crafty/longhorn)"
Cohesion: 0.07
Nodes (28): arr-stack Deployment, FlareSolverr container, arr-stack-ingress, Jellyseerr container, Lidarr container, arr-stack Namespace, Radarr container, arr-stack-service (+20 more)

### Community 2 - "ArgoCD Application Definitions"
Cohesion: 0.1
Nodes (27): arr-stack Argo Application, cert-manager Argo Application, crafty/minecraft Argo Application, dashy Argo Application, frostbite Argo Application, jellyfin Argo Application, librespeed Argo Application, longhorn Argo Application (+19 more)

### Community 3 - "Application Manifests (WebUI/SearXNG/Vaultwarden/Tachidesk)"
Cohesion: 0.16
Nodes (21): Open WebUI Deployment, Open WebUI Ingress, Open WebUI PVC 10Gi Longhorn, Open WebUI ClusterIP Service, RWO PVC + Recreate strategy deadlock avoidance, SearXNG Settings ConfigMap, SearXNG Deployment, SearXNG Ingress (basic auth) (+13 more)

### Community 4 - "Storage & Deployment Patterns"
Cohesion: 0.11
Nodes (18): Jellyseerr Config PVC, Lidarr Config PVC, Radarr Config PVC, Sonarr Config PVC, Wizarr Data PVC, dashy Deployment, dashy Ingress, dashy Namespace (+10 more)

### Community 5 - "Tdarr & VPN Torrent Stack"
Cohesion: 0.19
Nodes (16): HostPath /mnt/nas/media Volume, Tdarr Cache PV+PVC hostPath 90Gi, Tdarr Server Headless Service, Tdarr Media PV+PVC SMB 10Ti RWX, Tdarr Server StatefulSet, Tdarr Worker (Node) Deployment, Gluetun VPN sidecar provides network for torrent containers, Aria2 Container (+8 more)

### Community 6 - "Monitoring Stack Helm Config"
Cohesion: 0.32
Nodes (12): ArgoCD Multi-Source Pattern (Helm chart from upstream + values from git), LibreSpeed Helm Chart, Alloy Logs Collector Config, Alloy Metrics Collector Config, Grafana Config, Kube State Metrics Config, Loki Config (monolithic mode), Mimir Config (classic architecture) (+4 more)

### Community 7 - "Minecraft/Crafty & MetalLB"
Cohesion: 0.2
Nodes (10): lan-pool IPAddressPool, Crafty Controller container, crafty-web ClusterIP Service, minecraft-server headless Service, crafty-ingress, minecraft-lan LoadBalancer Service, minecraft Namespace, minecraft-server StatefulSet (+2 more)

### Community 8 - "Reverse-Proxy Pattern (External Backends)"
Cohesion: 0.25
Nodes (9): Proxmox VE Node 2, Proxmox VE Node 3, Proxmox VE Node 4, Reverse Proxy External Service Pattern, Router Web Interface, Speed Test Server, TrueNAS 2 Web Interface, Ubuntu Server 1 (+1 more)

### Community 9 - "Documentation & Bootstrap"
Cohesion: 0.32
Nodes (8): AGENTS.md â€” Agent Instructions, ArgoCD Helm Chart, CLAUDE.md â€” Repo Conventions & Patterns, Incident 001: Longhorn Mount Failures, Incidents Index, ArgoCD Master Application (app-of-apps), README.md â€” Homelab Overview, restore-pod.yaml â€” Standalone Restore Pod

### Community 10 - "SMB Shared Storage"
Cohesion: 1.0
Nodes (4): arr-stack SMB PV media-pv, SMB CSI RWX shared storage, jellyfin SMB PV media2, minio-data SMB PV

## Knowledge Gaps
- **76 isolated node(s):** `AGENTS.md â€” Agent Instructions`, `restore-pod.yaml â€” Standalone Restore Pod`, `ArgoCD Helm Chart`, `ArgoCD Multi-Source Pattern (Helm chart from upstream + values from git)`, `cert-manager Argo Application` (+71 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **7 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Recreate strategy for RWO volumes` connect `Infrastructure Manifests (arrs/jellyfin/crafty/longhorn)` to `Storage & Deployment Patterns`?**
  _High betweenness centrality (0.049) - this node is a cross-community bridge._
- **Why does `ArgoCD Master Project` connect `ArgoCD Application Definitions` to `Documentation & Bootstrap`?**
  _High betweenness centrality (0.042) - this node is a cross-community bridge._
- **Why does `dashy Deployment` connect `Storage & Deployment Patterns` to `Infrastructure Manifests (arrs/jellyfin/crafty/longhorn)`?**
  _High betweenness centrality (0.035) - this node is a cross-community bridge._
- **Are the 24 inferred relationships involving `Reverse-Proxy External Backend Pattern` (e.g. with `code-server Endpoints` and `code-server Ingress`) actually correct?**
  _`Reverse-Proxy External Backend Pattern` has 24 INFERRED edges - model-reasoned connections that need verification._
- **Are the 2 inferred relationships involving `VPN Torrent Multi-Container Deployment` (e.g. with `RWO PVC + Recreate strategy deadlock avoidance` and `Gluetun VPN sidecar provides network for torrent containers`) actually correct?**
  _`VPN Torrent Multi-Container Deployment` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `AGENTS.md â€” Agent Instructions`, `restore-pod.yaml â€” Standalone Restore Pod`, `ArgoCD Helm Chart` to the rest of the system?**
  _76 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Reverse-Proxy External Services` be split into smaller, more focused modules?**
  _Cohesion score 0.09 - nodes in this community are weakly interconnected._