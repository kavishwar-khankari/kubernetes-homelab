# Graph Report - kubernetes-homelab  (2026-05-11)

## Corpus Check
- 5 files · ~13,791 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 246 nodes · 305 edges · 22 communities (14 shown, 8 thin omitted)
- Extraction: 71% EXTRACTED · 29% INFERRED · 0% AMBIGUOUS · INFERRED: 89 edges (avg confidence: 0.84)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `c2488705`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]

## God Nodes (most connected - your core abstractions)
1. `ArgoCD Master Project` - 27 edges
2. `Longhorn distributed block storage` - 13 edges
3. `VPN Torrent Multi-Container Deployment` - 12 edges
4. `Monitoring & Observability Design Conversation` - 10 edges
5. `arr-stack Deployment` - 10 edges
6. `Architecture` - 7 edges
7. `minecraft-server StatefulSet` - 7 edges
8. `jellyfin Deployment` - 7 edges
9. `Open WebUI Ingress` - 7 edges
10. `Gluetun VPN Proxy Container` - 7 edges

## Surprising Connections (you probably didn't know these)
- `Monitoring & Observability Design Conversation` --references--> `Alloy Logs Collector Config`  [EXTRACTED]
  2026-05-05-154404-i-wan-to-add-monitoring-and-observability-to-my.txt → helm/monitoring-alloy-logs/values.yaml
- `Monitoring & Observability Design Conversation` --references--> `Kube State Metrics Config`  [EXTRACTED]
  2026-05-05-154404-i-wan-to-add-monitoring-and-observability-to-my.txt → helm/monitoring-kube-state-metrics/values.yaml
- `Monitoring & Observability Design Conversation` --references--> `Node Exporter Config`  [EXTRACTED]
  2026-05-05-154404-i-wan-to-add-monitoring-and-observability-to-my.txt → helm/monitoring-node-exporter/values.yaml
- `cert-manager Argo Application` --references--> `ArgoCD Master Project`  [EXTRACTED]
  argo-apps/cert-manager.yaml → argo-master-app/master-project.yaml
- `crafty/minecraft Argo Application` --references--> `ArgoCD Master Project`  [EXTRACTED]
  argo-apps/crafty.yaml → argo-master-app/master-project.yaml

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

## Communities (22 total, 8 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.09
Nodes (39): code-server Endpoints, code-server Ingress, code-server Service, files-2 Endpoints, files-2 Ingress, files-2 Service, immich Endpoints, immich Ingress (+31 more)

### Community 1 - "Community 1"
Cohesion: 0.07
Nodes (28): arr-stack Deployment, FlareSolverr container, arr-stack-ingress, Jellyseerr container, Lidarr container, arr-stack Namespace, Radarr container, arr-stack-service (+20 more)

### Community 2 - "Community 2"
Cohesion: 0.1
Nodes (27): arr-stack Argo Application, cert-manager Argo Application, crafty/minecraft Argo Application, dashy Argo Application, frostbite Argo Application, jellyfin Argo Application, librespeed Argo Application, longhorn Argo Application (+19 more)

### Community 3 - "Community 3"
Cohesion: 0.16
Nodes (21): Open WebUI Deployment, Open WebUI Ingress, Open WebUI PVC 10Gi Longhorn, Open WebUI ClusterIP Service, RWO PVC + Recreate strategy deadlock avoidance, SearXNG Settings ConfigMap, SearXNG Deployment, SearXNG Ingress (basic auth) (+13 more)

### Community 4 - "Community 4"
Cohesion: 0.11
Nodes (19): Architecture, Cluster Overview, code:block1 (ArgoCD (app-of-apps)), code:block2 (argo-master-app/          # Bootstrap — single app that mana), code:block3 (/mnt/merged/media  ← mergerfs union (read from both)), Download Stack (VPN-protected), GitOps, GPU (+11 more)

### Community 5 - "Community 5"
Cohesion: 0.11
Nodes (18): Jellyseerr Config PVC, Lidarr Config PVC, Radarr Config PVC, Sonarr Config PVC, Wizarr Data PVC, dashy Deployment, dashy Ingress, dashy Namespace (+10 more)

### Community 6 - "Community 6"
Cohesion: 0.13
Nodes (12): ArgoCD Helm Chart, Incident 001: Longhorn Mount Failures, Incidents Index, Bootstrap, graphify, Two deployment patterns, Watch for, Reading Reddit threads (+4 more)

### Community 7 - "Community 7"
Cohesion: 0.19
Nodes (16): HostPath /mnt/nas/media Volume, Tdarr Cache PV+PVC hostPath 90Gi, Tdarr Server Headless Service, Tdarr Media PV+PVC SMB 10Ti RWX, Tdarr Server StatefulSet, Tdarr Worker (Node) Deployment, Gluetun VPN sidecar provides network for torrent containers, Aria2 Container (+8 more)

### Community 8 - "Community 8"
Cohesion: 0.36
Nodes (11): ArgoCD Multi-Source Pattern (Helm chart from upstream + values from git), Alloy Logs Collector Config, Alloy Metrics Collector Config, Grafana Config, Kube State Metrics Config, Loki Config (monolithic mode), Mimir Config (classic architecture), Node Exporter Config (+3 more)

### Community 9 - "Community 9"
Cohesion: 0.2
Nodes (10): lan-pool IPAddressPool, Crafty Controller container, crafty-web ClusterIP Service, minecraft-server headless Service, crafty-ingress, minecraft-lan LoadBalancer Service, minecraft Namespace, minecraft-server StatefulSet (+2 more)

### Community 10 - "Community 10"
Cohesion: 0.22
Nodes (9): 1. In-cluster apps (`manifests/<app>/` + `argo-apps/<app>.yaml`), 2. External-service reverse proxies (`reverse-proxy/<app>/`), Bootstrap, Conventions, Incidents, kubernetes-homelab, Patterns, Repo layout — two deployment patterns coexist (+1 more)

### Community 11 - "Community 11"
Cohesion: 0.25
Nodes (9): Proxmox VE Node 2, Proxmox VE Node 3, Proxmox VE Node 4, Reverse Proxy External Service Pattern, Router Web Interface, Speed Test Server, TrueNAS 2 Web Interface, Ubuntu Server 1 (+1 more)

### Community 12 - "Community 12"
Cohesion: 0.29
Nodes (6): Affected, Fix Steps, Incident 001: Longhorn mount failures on k3s-node-3, Prevention, Root Cause, Symptoms

### Community 13 - "Community 13"
Cohesion: 1.0
Nodes (4): arr-stack SMB PV media-pv, SMB CSI RWX shared storage, jellyfin SMB PV media2, minio-data SMB PV

## Knowledge Gaps
- **107 isolated node(s):** `Watch for`, `Two deployment patterns`, `Bootstrap`, `graphify`, `Web search` (+102 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **8 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `ArgoCD Master Project` connect `Community 2` to `Community 6`?**
  _High betweenness centrality (0.059) - this node is a cross-community bridge._
- **Why does `Kubernetes Homelab` connect `Community 4` to `Community 6`?**
  _High betweenness centrality (0.042) - this node is a cross-community bridge._
- **Why does `Recreate strategy for RWO volumes` connect `Community 1` to `Community 5`?**
  _High betweenness centrality (0.033) - this node is a cross-community bridge._
- **Are the 24 inferred relationships involving `Reverse-Proxy External Backend Pattern` (e.g. with `code-server Endpoints` and `code-server Ingress`) actually correct?**
  _`Reverse-Proxy External Backend Pattern` has 24 INFERRED edges - model-reasoned connections that need verification._
- **Are the 2 inferred relationships involving `VPN Torrent Multi-Container Deployment` (e.g. with `RWO PVC + Recreate strategy deadlock avoidance` and `Gluetun VPN sidecar provides network for torrent containers`) actually correct?**
  _`VPN Torrent Multi-Container Deployment` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Watch for`, `Two deployment patterns`, `Bootstrap` to the rest of the system?**
  _107 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.09 - nodes in this community are weakly interconnected._