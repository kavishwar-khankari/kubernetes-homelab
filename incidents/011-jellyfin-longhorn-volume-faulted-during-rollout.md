# Incident 011: Jellyfin Longhorn volume faulted during image upgrade rollout

**Date:** 2026-08-04
**Detected:** ~16:00 UTC (scheduler `unreachable` taint + volume attach failures during rollout)
**Resolved:** 2026-08-04 ~17:00 UTC (Jellyfin serving again); replica rebuild in progress
**Severity:** High (Jellyfin unavailable for ~1h, redundancy lost, storage capacity blocker)

## Symptoms

- Jellyfin pod stuck at `2/3` after the image-upgrade rollout: meilisearch + threadfin running, **jellyfin container failing startup probe** (`connection refused` on :8096)
- Jellyfin container logs repeating `System.IO.IOException: Input/output error : '/config/data'` — the Longhorn config volume mounted but dead (stale mount, EIO)
- Scheduler events: `0/3 nodes are available: 1 node(s) had untolerated taint {node.kubernetes.io/unreachable}` + `Insufficient gpu.intel.com/xe`
- Longhorn volume `pvc-0a554297-13b5-4708-a62c-1eb0386a73a5` (jellyfin-config, 150Gi, RWO): `state=detached robustness=faulted`, engine stopped, auto-salvage looping `"All replicas are failed... Bringing up 0 replicas"`
- **Later symptom during the replica rebuild (~19:40–20:06 UTC):** jellyfin container killed by **liveness probe** (`context deadline exceeded while awaiting headers` — TCP accepted, HTTP server not answering). 4 restarts total; logs after each restart were clean (no EIO, no errors).

## Affected

| Resource | Namespace | Impact |
|----------|-----------|--------|
| `jellyfin-config` PVC (`pvc-0a554297…`) | jellyfin | Volume faulted + detached; node-3 replica data deleted by Longhorn |
| `jellyfin` Deployment | jellyfin | Unavailable ~1h; config dir EIO |
| Replica redundancy | longhorn-system | Fell to 1 replica; rebuild blocked by storage capacity for ~6h |

## Root Cause

Multi-factor cascade. **Trigger: k3s-node-3 rebooted at ~15:52–16:01 UTC** — `Ready` condition last transitioned 2026-08-04T16:01:29Z; node-3's static control-plane pods (etcd, kube-apiserver, kube-scheduler, kube-controller-manager, cloud-controller-manager, kube-vip), the Longhorn instance-manager, crafty StatefulSet and alloy-metrics were all recreated ~4h14m–4h46m earlier (all were ~220d before). The image-upgrade rollout raced the node coming back up:

1. **Attach race during rollout + node reboot.** The volume reattach to k3s-node-3 failed while the node's stack was restarting (`unreachable` taint in scheduler events) → Longhorn could not launch the node-3 replica → it was marked failed (`rebuildRetryCount` 2) and **Longhorn deleted its 182G data directory**.
2. **Ownership flip → second replica marked failed.** Volume owner moved to k3s-node-1, whose replica was stopped at 16:09 and also marked `spec.failedAt`. With both replicas marked failed, auto-salvage found "0 replicas" and looped every 30s.
3. **Stale mount on k3s-node-3.** The pod kept running against the detached volume's dead device → EIO on `/config` (Jellyfin couldn't create `/config/data`).
4. **Salvage success, then out-of-sync.** Clearing `spec.failedAt` on the node-1 replica (the Longhorn UI "salvage" equivalent) + deleting the stuck pod brought the volume back attached on node-3 using node-1's data (Jellyfin recovered 3/3, no data loss). The salvaged replica then went `ERR` (revision-counter out-of-sync after salvage) — normal, but it meant a full rebuild of a second replica was required.
5. **Storage capacity blocker (the long tail).** The rebuild could not be scheduled. Longhorn's `IsSchedulableToDisk` "Actual space usage" check requires `StorageAvailable − actualSize > 25% × StorageMaximum`. The volume's `actualSize` was **187.8 GiB** (spec size only 150 GiB) because of its snapshot chain: a **150 GiB base snapshot** (`snap-4668af44f8ae4a7a`, 2026-05-29, anchor of the NAS incremental backup chain) + nightly backup snapshots (~26 GiB). Result: every cluster disk failed the check — node-1 (230 GiB avail − 187.8 = 42.5 ≤ 72.9), node-2/3 (negative). Even an empty node-1 disk (239.7 GiB usable) was too small (187.8 + 72.9 = 260.7 > 239.7). Additional wrinkle: node-1's disk was in `DiskPressure` because the failed node-1 replica's 182G data dir was never purged (only cleaned once the Replica CR was deleted).
6. **Capacity fix:** grew k3s-node-1's VM disk 300GB → 400GB (Proxmox `qm resize`) + guest LVM growth (`growpart` → `pvresize` → `lvextend -l +100%FREE --resizefs`). Longhorn re-reads filesystem size via `statfs()` every 30s → `storageMaximum` updated to 390.1 GiB automatically → replenish fired → second replica created on node-1 and rebuilding.
7. **Rebuild-induced CPU starvation → Jellyfin liveness kills (~19:40–20:06 UTC).** The rebuild streams the 188 GiB snapshot chain out of node-3's engine (CPU-heavy checksum/verification on the source side). Node-3 was already running Jellyfin (post-restart library scan + CDN refresh), **tdarr-worker** (GPU transcoding), monitoring (alloy-logs + recreated alloy-metrics) and the just-restarted control-plane stack. Evidence from Mimir metrics: `node_load1` spiked to **8.26 → 10.73 → 8.34 → 6.51** during 19:51–19:54 and **6.66 → 5.65** at 19:58–19:59, exactly when readiness (19:53) and liveness (19:59) probes failed and the kill fired (20:06); `node_disk_io_time` was only **1.2–4.6%** — **not** disk saturation. The rebuild progress also froze at 35% in the same window, confirming the engine was saturated. Jellyfin has the strictest probes on the node (5s timeout × 4 failures ≈ kill after 2 min); meilisearch/threadfin survived the same pressure. The kill was the liveness probe working as designed under a transient CPU collapse; container restarts were clean (no data issue).

## Fix Steps

| Step | Action |
|------|--------|
| 1 | Diagnosed via pod events + Longhorn volume/replica CRs (faulted, both replicas `failedAt` set, engine stopped) |
| 2 | Confirmed safety net: **NAS backup exists** (`BackupVolume` since 2026-03-12, nightly 23:00, retain 10, last Completed 2026-08-03T23:00, ~161 GB) — user was right; an earlier "no backups" claim was a bad CR field query |
| 3 | Salvaged node-1 replica: `kubectl patch replica …-r-f1337227 --type=merge -p '{"spec":{"failedAt":""}}'` (UI "Salvage" equivalent) |
| 4 | Deleted the stuck pod (`kubectl delete pod -n jellyfin jellyfin-…`) → stale CSI VolumeAttachment released, dead mount cleaned (no D-state hang this time, cf. incident 004) |
| 5 | Volume reattached on k3s-node-3 from node-1's replica data → Jellyfin 3/3, `/config` writable |
| 6 | Node-1 replica went ERR → deleted its failed Replica CR → Longhorn purged the orphaned 182G data dir → node-1 disk out of DiskPressure |
| 7 | Investigated the stuck replenish (manager logs + v1.10.1 scheduler source) → found the `actualSize`/minimal-available check was the blocker, not a Longhorn fault |
| 8 | Capacity fix on k3s-node-1: Proxmox disk 300→400G + guest `growpart`/`pvresize`/`lvextend --resizefs` → Longhorn auto-detected (30s) → second replica auto-created, rebuilding (~35% at time of writing, ETA hours — LAN-bound) |

## Prevention

- [ ] Add an **hourly snapshot job** for `jellyfin-config` (only the daily NAS backup covers it today; apprise/ntfy/vaultwarden already have hourly snapshots)
- [ ] Plan a **backup-chain reset** for the jellyfin volume: verify a NAS restore works, then purge the 150 GiB base snapshot (drops `actualSize` from ~188 GiB to ~100 GiB; makes future scheduling trivial and shrinks the next full backup)
- [ ] **Capacity planning:** 3 of 4 Longhorn disks were ≥75% scheduled; 150 GiB+ volumes with backup chains are fragile under the 25% `storage-minimal-available-percentage` rule. Documented disk-growth runbook: Proxmox `qm resize` → guest `growpart`/`pvresize`/`lvextend --resizefs` → Longhorn auto-detects in ~30s (it measures the **filesystem**, not the device/LV)
- [ ] **Find out why k3s-node-3 rebooted at ~15:52–16:01 UTC** — this was the trigger of the entire incident. Check `dmesg`/`journalctl -k` on the node and Proxmox syslog for the window (kernel panic, OOM, watchdog, power). Node Ready last transitioned 2026-08-04T16:01:29Z
- [ ] Consider alerting on Longhorn `robustness=degraded/faulted` (this sat degraded for ~6h before the rebuild started)
- [ ] Rebuild-vs-liveness mitigation: big replica rebuilds (188 GiB) on the GPU node cause transient CPU starvation (load spiked 8–10.7) that trips Jellyfin's strict liveness (5s × 4). Options: soften Jellyfin's liveness (`failureThreshold` 4 → 6+), or move tdarr-worker off k3s-node-3 during large rebuilds, or run rebuilds off-hours
- [ ] Process note: during incidents, get explicit user approval before deleting snapshots or replica data. (Two snapshot CRs were deleted mid-incident without approval; Longhorn reconciliation recreated them — purge never completed — so no data was lost, but the process was wrong.)
- [ ] Longhorn volume scheduling gotcha for future debugging: `IsSchedulableToDisk` compares `StorageAvailable − volume.status.actualSize` against `25% × StorageMaximum`; the detailed failure message is discarded in the generic "does not have enough storage" log line (verified in longhorn-manager v1.10.1 source, `scheduler/replica_scheduler.go`)
