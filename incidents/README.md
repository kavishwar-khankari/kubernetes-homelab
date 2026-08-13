# Incidents

Quick-reference tracker. Each incident has a dedicated file in this directory.

## Index

| # | Date | Title | Severity | Node(s) | Root Cause | Status |
|---|------|-------|----------|---------|------------|--------|
| [1](./001-longhorn-mount-failures.md) | 2026-05-09 | Longhorn mount failures (exit 32) | High | k3s-node-3 | multipathd hijacking iSCSI + engine-image OOM | Resolved |
| [2](./002-loki-chunks-cache-memory-overprovisioning.md) | 2026-05-27 | Loki chunks cache memory overprovisioning | Medium | k3s-node-1 | Loki chart defaults (8Gi cache, no TTL) | Resolved |
| [3](./003-node-dns-image-pull-failure.md) | 2026-06-06 | Node DNS failure causing image pull failures | Medium | k3s-node-2 | systemd-resolved inactive + inotify exhaustion + missing upstream DNS | Resolved |
| [4](./004-jellyfin-stuck-containercreating-runtime-hang.md) | 2026-07-06 | Jellyfin stuck ContainerCreating after old pod deletion | High | k3s-node-3 | stale Jellyfin/ffmpeg process in uninterruptible sleep blocked pod cleanup | Resolved |
| [5](./005-tailscale-subnet-router-invalid-auth-key.md) | 2026-07-06 | Tailscale subnet router invalid auth key | Medium | k3s-node-1, k3s-node-2 | Doppler synced a rejected Tailscale auth key | Resolved |
| [6](./006-qbittorrent-502-stale-lockfile.md) | 2026-07-06, 2026-07-16, 2026-07-23 | qBittorrent ingress 502 from stale lockfile | Medium | k3s-node-2, k3s-node-3 | stale qBittorrent lockfile from old pod blocked WebUI startup | Resolved |
| [7](./007-tdarr-server-pvc-full-statefulset-resize.md) | 2026-07-07 | Tdarr server PVC full after StatefulSet resize drift | High | k3s-node-3 | existing server PVC stayed 5Gi because StatefulSet volumeClaimTemplate resize was immutable | Resolved |
| [8](./008-cilium-mtu-github-egress.md) | 2026-07-10 | Cilium MTU mismatch blocked GitHub HTTPS egress | High | All nodes | Tailscale MTU 1280 drove Cilium VXLAN auto-detection | Resolved |
| [9](./009-arr-import-failures-stale-smb-credentials.md) | 2026-07-19, 2026-07-25 | Arr imports blocked by inaccessible NAS content | High | k3s-node-2, TrueNAS | stale SMB credentials; inherited ACL lacked directory traversal for SMB user | Resolved |
| [10](./010-qbittorrent-public-api-auth-bypass.md) | 2026-07-20, 2026-08-11 | qBittorrent public API authentication bypass | High | k3s-node-3, external qBittorrent | local and `0.0.0.0/0` subnet authentication bypasses were enabled | Mitigated; private ingress cutover pending |
| [11](./011-jellyfin-longhorn-volume-faulted-during-rollout.md) | 2026-08-04 | Jellyfin Longhorn volume faulted during image rollout | High | k3s-node-3, k3s-node-1 | attach race during pod swap → replicas marked failed + deleted; rebuild blocked by snapshot-chain storage footprint | Resolved (replica rebuild in progress) |
| [12](./012-immich-duplicate-smb-pvc-volumes.md) | 2026-08-06 | Immich stuck ContainerCreating with duplicate SMB PVC volumes | High | k3s-node-1 | same SMB PVC rendered as five Pod volumes stalled kubelet before sandbox creation | Resolved |
| [13](./013-wg-gateway-cilium-mark-collision.md) | 2026-08-08 | WireGuard gateway fwmark collided with Cilium identity marks | High | k3s-node-1 | custom `0x10000` policy mark overlapped Cilium endpoint identity bits | Resolved |
| [14](./014-needrestart-mergerfs-restart-stale-bind.md) | 2026-08-11 | Jellyfin playback dead after needrestart bounced mergerfs | High | k3s-node-3 | unattended-upgrade of systemd → needrestart restarted mergerfs-media.service → pod kept stale hostPath bind | Resolved |
| [15](./015-pangolin-404-badger-plugin-cache-network-recreate.md) | 2026-08-13 | Pangolin total 404 after compose network recreate | High | VPS ampere-vm, all Newt pods | bridge recreation changed ID (firewall no egress) + ephemeral Traefik plugin cache → badger middleware undefined | Resolved |
