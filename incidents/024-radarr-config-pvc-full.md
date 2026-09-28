# Incident 024: Radarr config PVC full — arr-stack NotReady (startup ENOSPC)

**Date:** 2026-09-27 (volume full) to 2026-09-28 (hard startup failure)
**Detected:** 2026-09-28 ~14:12 IST (pod replacement surfaced the failure)
**Resolved:** 2026-09-28 14:32 IST (PVC expanded 1Gi → 3Gi online; Radarr listening again)
**Severity:** High (entire arr-stack pod NotReady — radarr, sonarr, wizarr, jellyseerr all removed from Service endpoints)

## Symptoms

- `arr-stack-568b745f4f-kfrl6` was `3/4 Running`; the radarr container was not ready and restarting (liveness kills, exit 137).
- Radarr logs showed a startup failure:
  - `[Fatal] ... Radarr failed to start: AppFolder /config is not writable`
  - `Directory '/config' isn't writable. No space left on device : '/config/radarr_write_test.txt'`
- `arr-stack-service` EndpointSlice had `ready=0, notready=1` — all four apps unreachable through their ingresses.
- Older logs (from 2026-09-27 19:26 IST) captured the fill moment:
  - `System.IO.IOException: No space left on device : '/config/MediaCover/279/fanart.jpg.part'`
  - SQLite errors during movie scans and extra-file imports: `database or disk is full` (Full 13) and `disk I/O error` (IoErr 10).
- `df -h /config`: `974M size, 958M used, 0 avail, 100%`.

## Affected

| Resource | Impact |
|---|---|
| `arr-stack` Deployment (radarr, sonarr, wizarr, jellyseerr) | Pod `3/4` NotReady; all apps out of the Service endpoints |
| `radarr-config` PVC / Longhorn volume `pvc-8645fe65-f2e4-4039-be47-2f885d615202` | 1Gi volume 100% full on `k3s-node-2` |
| Radarr library operations | Imports/scans failed with SQLite I/O errors from 2026-09-27 19:26 until the fix |

## Root Cause

The 1Gi `radarr-config` Longhorn PVC was saturated at 2026-09-27 19:26 IST. Contents at saturation:

| Path | Size |
|---|---|
| `/config/MediaCover` (394 movies' poster/fanart cache) | 788M |
| `/config/logs` (`LogLevel=debug`; ~1MB rotation) | 102M |
| `/config/radarr.db` + `logs.db` + WAL | ~38M |
| `/config/Backups` | 31M |

With zero bytes free, Radarr could not write; the process stayed alive but DB writes and imports failed. When the pod was replaced on 2026-09-28 ~14:12 IST (same ReplicaSet; not ArgoCD, not a node reboot, no eviction — consistent with a manual pod delete), Radarr's startup write test to `/config` failed with ENOSPC, so the process aborted and the liveness probe crash-looped the container.

Contributing factors:

- Sibling `sonarr-config` had been grown 1Gi → 3Gi (commit `35b4627`); `radarr-config` was never revisited.
- Radarr `LogLevel` is `debug` (`config.xml`), producing ~100M of rotated logs on a 1Gi volume.
- No PVC capacity/usage alerting exists (zero PrometheusRules in git for the monitoring stack).

Same failure class as incident 007 (Tdarr server PVC full).

## Fix Steps

| Step | Action |
|------|--------|
| 1 | Confirmed pod `3/4` with radarr unready; read logs (`AppFolder /config is not writable`, ENOSPC). |
| 2 | Confirmed `/config` 100% full and mapped the top consumers (`MediaCover` 788M, logs 102M). |
| 3 | Grew `radarr-config` 1Gi → 3Gi in `manifests/arrs/storage.yaml` (commit `9613968`), pushed to `main`. |
| 4 | Pruned rotated log files (`radarr.[0-9]*.txt`, `radarr.debug.[0-9]*.txt`) → freed ~100M immediately (858M used, 90%). |
| 5 | ArgoCD auto-synced at 09:01:30Z and patched the PVC; Longhorn expanded the attached volume online (`spec.size=3221225472`) and kubelet grew ext4 in place — `df` showed `3.0G size, 857M used, 2.1G avail, 29%`. No pod restart or detach was needed for the resize. |
| 6 | Radarr restarted, passed the write test, and began listening (`Now listening on: http://[::]:7878`); pod reached `4/4` Ready and the EndpointSlice showed `ready=1`. |

## Verification

- PVC: `requests=3Gi`, `capacity=3Gi`; Longhorn volume `spec.size=3Gi`, attached, healthy.
- `arr-stack` pod `4/4 Running`, all containers ready; EndpointSlice `ready=1`.
- ArgoCD app `arr-stack`: Synced + Healthy at revision `9613968`.
- Radarr log after recovery: DB migrations ran clean, application started, no I/O errors.

## Prevention

- [ ] Add PVC usage alerting: `kubelet_volume_stats_used_bytes / kubelet_volume_stats_capacity_bytes > 80%` (no PrometheusRules exist yet).
- [ ] Set Radarr `LogLevel` from `debug` → `info` (Settings → General) to cut rotated log volume roughly in half.
- [ ] Re-audit remaining small config PVCs (lidarr 2Gi, jellyseerr 2Gi — currently low usage) before they follow the same path.
- [ ] Post-recovery check: run a Radarr library scan and confirm no DB errors from the ~19h write-broken window.

## Related

- Incident 007 (Tdarr server PVC full — same failure class; source of the Longhorn in-place expansion playbook)
