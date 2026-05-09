# Incident 001: Longhorn mount failures on k3s-node-3

**Date:** 2026-05-09  
**Detected:** 2026-05-08 18:33 UTC (events first appeared ~39h prior)  
**Resolved:** 2026-05-09 14:20 UTC  
**Severity:** High (5 pods stuck, including vaultwarden, tdarr)  

## Symptoms

- Pods stuck `ContainerCreating` on k3s-node-3
- Events: `MountVolume.MountDevice failed - exit status 32 - already mounted or mount point busy`
- Variants: `"hasn't been attached yet"`, `"Staging target path is no longer valid"`
- Longhorn engine-image on node-3: **42 restarts**, last with **exit code 137 (SIGKILL/OOM)**

## Affected

| Pod | Namespace | PVC | Error |
|-----|-----------|-----|-------|
| `monitoring-mimir-alertmanager-0` | monitoring | `pvc-454d57ed` | exit 32 / mount busy |
| `tachidesk-*` | tachidesk | `pvc-94d62bb8` | exit 32 / mount busy |
| `vaultwarden-*` | vaultwarden | `pvc-6901deb8` | Staging path invalid |
| `tdarr-server-0` | tdarr | `pvc-1f2f94a1` | hasn't been attached / exit 32 |
| `tdarr-server-0` | tdarr | `pvc-b03ab07a` | hasn't been attached |

## Root Cause

1. **Engine-image OOM-killed** (exit 137) on k3s-node-3, crashing all volume engine processes on that node.  
   Node-3 is the GPU node running jellyfin + tdarr + multiple monitoring components, with Longhorn engine-image having **no resource limits**.

2. **Multipathd interference** — `multipathd` was running on all 3 nodes and claiming Longhorn iSCSI devices (vendor `IET`, product `VIRTUAL-DISK`) as multipath slaves.  
   After the OOM crash, the orphaned iSCSI device (`sdd`, 8:48) was held by multipath (`mpatha/dm-1`). When Longhorn restarted the engine, it got the same device slot (8:48), and the kernel refused to mount it because multipath already claimed it — hence "device busy."

3. **tdarr volume stuck in `creating`** — the volume state machine could not recover from the crash. Engine showed `desireState: stopped` despite volume being in `creating` state. Required manual state transition.

## Fix Steps

| Step | Action |
|------|--------|
| 1 | Blacklist Longhorn from multipath on all nodes: add `blacklist { device { vendor "IET" product "VIRTUAL-DISK" } }` to `/etc/multipath.conf` |
| 2 | Flush multipath maps: `multipath -F` |
| 3 | Reload multipath daemon: `systemctl reload multipathd` |
| 4 | Delete stale engines and volumeattachments for all stuck volumes |
| 5 | Delete stuck pods → recreate with fresh attach/mount |
| 6 | For tdarr volume: patch `spec.nodeID: ""` to force `creating → attached` transition |

## Prevention

- [x] Multipath blacklist applied cluster-wide (all 3 nodes)
- [x] Non-GPU workloads moved off k3s-node-3 (dashy, tachidesk, vaultwarden → `preferredDuringScheduling` node-1/2)
- [ ] Add resource limits to Longhorn engine-image and instance-manager pods
- [ ] Consider adding RAM to k3s-node-3 or moving monitoring StatefulSets (alloy-metrics, loki-results-cache) off it
