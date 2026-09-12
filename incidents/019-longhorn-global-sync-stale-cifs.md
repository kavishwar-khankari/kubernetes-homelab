# Incident 019: Longhorn global sync amplified a stale CIFS mount

**Date:** 2026-08-12 to 2026-08-20  
**Detected:** 2026-08-20  
**Service restored:** 2026-08-20 14:35 UTC  
**Residual cleanup complete:** 2026-08-20 15:54 UTC  
**Snapshot and backup validation complete:** 2026-08-20 16:13 UTC  
**Residual risk:** Active CIFS/FUSE waits on `k3s-node-3`; recurring jobs remain suspended  
**Severity:** Critical (control-plane node repeatedly became unavailable; stateful workloads lost replica redundancy)  

## Symptoms

- `k3s-node-2` repeatedly changed between `Ready` and `Unknown` while ICMP remained responsive.
- The host load average exceeded 10,900 and kubelet, etcd, kube-apiserver, and node-exporter became intermittently unavailable.
- More than 10,000 Longhorn threads were stuck in uninterruptible `D` state, primarily in `super_lock` and `sync_inodes`.
- Longhorn snapshots timed out and retried; monitoring pods became Pending when their volumes could not attach.
- A deleted `rdtclient-aria` pod still had processes, a CIFS bind, and two Longhorn mounts present on the host eight days after the Deployment was scaled to zero.

## Affected

| Resource | Impact |
|----------|--------|
| `k3s-node-2` | Kernel filesystem work queue exhaustion and repeated control-plane unavailability |
| `k3s-node-1` | Retained three blocked CIFS mount attempts and four Longhorn sync threads; two Arr engines could not detach |
| `k3s-node-3` | Post-recovery Jellyfin and Tdarr media reads intermittently remain in `D` state through the CIFS/FUSE media path |
| Longhorn | Snapshot retries blocked in host-wide `sync(2)`; node-2 replicas were marked failed |
| Monitoring StatefulSets | Loki and Mimir volumes temporarily could not attach after recovery |
| `rdtclient-aria` | Deleted pod UID retained `/data/downloads`, `rdtclient-db`, and `aria2-config` mounts |
| Cluster control plane | API and etcd on node 2 were starved; nodes 1 and 3 maintained quorum |

## Root Cause

1. The `rdtclient-aria` pod was scaled to zero on 2026-08-12, but its processes could not exit because reads from `/data/downloads` were blocked in CIFS reconnect handling.
2. Kubelet could not finish pod teardown, leaving the deleted pod cgroup, the stale CIFS bind, and two Longhorn filesystem mounts in the host mount namespace.
3. Longhorn v1.10.1 had `freeze-filesystem-for-snapshot` disabled. Before each user snapshot, the engine therefore entered the host mount namespace and called the global `sync(2)` syscall.
4. Global sync traversed all host superblocks, including the stale CIFS and orphaned ext4 mounts. Those calls became permanently blocked in the kernel.
5. Backup and snapshot reconciliation continued retrying. Each retry added another blocked Longhorn thread until approximately 10,789 were present during diagnosis and 10,907 immediately before reset.
6. The resulting scheduler and I/O pressure starved kubelet and the local RKE2 control-plane processes, producing the `Ready`/`Unknown` flapping.

The pre-existing `sdp` medium errors were not the initiating event: they appeared before the Longhorn thread explosion and require separate investigation.

Node 1 retained a smaller version of the same damage. It had three `mount.cifs` tasks blocked in `path_mount` and four Longhorn engines blocked in `sync_inodes_sb` or `super_lock`. The lower thread count did not make node 1 flap, but it prevented the `sonarr-config` and `jellyseerr-config` engines from stopping when Arr was moved to node 2.

The four application-specific hourly CronJobs were not part of the amplification. Their group labels existed only on the PVCs, without the required `recurring-job.longhorn.io/source=enabled` opt-in, so Longhorn selected zero volumes. The default-group nightly backup did select Longhorn volumes. The missing source label was discovered when the first controlled Apprise test also selected zero volumes.

After the controlled tests, node 3 continued to show 2 to 23 non-Longhorn blocked threads over a 60-second sample. The affected processes were `mergerfs-media.service`, Jellyfin `ffprobe`, and Tdarr workers reading through `/mnt/nas/media`. The SMB session remained connected, had no recorded reconnects, and the kernel had not yet logged a server timeout, but the persistent waits show the original CIFS initiating condition is not fully resolved.

## Fix Steps

| Step | Action |
|------|--------|
| 1 | Confirmed nodes 1 and 3 maintained API and etcd readiness and that all three nodes had 12:00 UTC etcd snapshots. |
| 2 | Verified affected Longhorn volumes had a surviving replica outside node 2. |
| 3 | Cordoned `k3s-node-2` and imperatively suspended all five generated Longhorn CronJobs to prevent new scheduled runs. |
| 4 | Reset the VM from Proxmox rather than attempting a graceful shutdown that could block on filesystem sync. |
| 5 | Confirmed the boot ID changed, load returned to normal, blocked-process count fell to zero, and the deleted pod's stale mounts did not return. |
| 6 | Verified the intended `/mnt/nas/media` CIFS mount reconnected to TrueNAS and API/etcd readiness remained healthy. |
| 7 | Briefly uncordoned the node so Longhorn could recreate its instance-manager; the cordon had correctly prevented the replacement pod from scheduling. |
| 8 | Confirmed all application pods returned ready and Longhorn began rebuilding failed replicas at its configured per-node concurrency limit. |
| 9 | Moving Arr back to its preferred node exposed two engines stuck in `stopping` on node 1; force-detach was rejected because the old writable engines were still alive. |
| 10 | Verified nodes 2 and 3 were clean and healthy, cordoned node 1, and reset it from Proxmox. |
| 11 | Confirmed node 1 returned with a new boot ID, zero blocked tasks, and a healthy replacement Longhorn instance-manager. |
| 12 | Allowed Kubernetes to reschedule displaced workloads, then moved the remaining safe node-2-preferred applications sequentially after their RWO volumes were healthy. |
| 13 | Verified all workloads ready, all 32 attached Longhorn volumes healthy, and zero blocked tasks on every node. |
| 14 | Added the missing PVC recurring-job source label, then ran an isolated Apprise snapshot. Engine logs confirmed filesystem freeze, snapshot, and unfreeze with no fallback global sync. |
| 15 | Ran a concurrency-1 backup for only the Apprise volume. Backup `backup-0423228a12df485d` completed successfully, and no Longhorn blocked threads accumulated. |
| 16 | Kept every recurring CronJob suspended after detecting persistent node-3 CIFS/FUSE waits; no drain, unmount, or reset was attempted while the node and applications remained healthy. |

## Prevention

- [x] Configure Longhorn v1 filesystem volumes to freeze mounted filesystems instead of using host-wide sync before snapshots.
- [x] Reduce the nightly `backup-to-nas` recurring job from concurrency 2 to 1 and place it under GitOps management.
- [x] Stagger the four hourly snapshot jobs instead of launching all of them at minute zero.
- [x] Add `recurring-job.longhorn.io/source=enabled` to the four protected PVCs so their group labels propagate to Longhorn volumes.
- [x] Keep generated snapshot and backup CronJobs suspended throughout both node recoveries and replica rebuilds.
- [x] Run one controlled snapshot and one controlled backup with filesystem freeze and no accumulating Longhorn blocked threads.
- [ ] Resolve or explain the active node-3 media CIFS waits before resuming recurring snapshot and backup schedules.
- [ ] Push and sync the GitOps changes, then verify `freeze-filesystem-for-snapshot` is `{"v1":"true"}` in the cluster.
- [ ] Remove the obsolete `rdtclient-aria` Deployment and its PVCs after confirming retained data is no longer required.
- [ ] Add alerts for CIFS reconnects, blocked processes, I/O pressure, failed pod kills, and Longhorn snapshot timeouts.
- [ ] Add workload startup checks that reject local-directory fallbacks when the expected hostPath filesystem is not mounted.
- [ ] Investigate the TrueNAS outage and the separate `sdp` medium errors.
- [ ] Disable or correctly blacklist `multipathd` on every Longhorn node and clear the current Longhorn node warning.

Longhorn still falls back to global sync when filesystem freeze is disabled, the volume uses block mode, the endpoint is not mounted, or freezing fails. Snapshot scheduling limits reduce amplification but do not replace mount monitoring and controlled recovery.
