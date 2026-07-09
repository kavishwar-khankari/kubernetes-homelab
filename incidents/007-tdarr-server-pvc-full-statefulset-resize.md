# Incident 007: Tdarr server PVC full after StatefulSet resize drift

**Date:** 2026-07-07
**Detected:** Tdarr server repeatedly failed startup probe and worker stayed in init wait
**Resolved:** 2026-07-07
**Severity:** High (Tdarr server unavailable; worker could not start)

## Symptoms

- `tdarr-server-0` was `0/1 Running` with repeated restarts.
- `tdarr-worker-*` was stuck in `Init:0/1` waiting for `http://tdarr-server.tdarr.svc.cluster.local:8265/api/v2/status`.
- Pod events showed repeated startup probe failures:
  - `Startup probe failed: Get "http://10.42.3.127:8265/api/v2/status": dial tcp 10.42.3.127:8265: connect: connection refused`
- Tdarr server logs showed repeated SQLite write failures:
  - `SQLITE_IOERR: disk I/O error`
  - Followed by `TypeError: Cannot read properties of undefined (reading 'findIndex')` during DB initialization.
- `/app/server` was full inside the server pod:
  - `4.9G used`, `0 available`, `100%`.

## Affected

| Resource | Namespace | Node | Impact |
|----------|-----------|------|--------|
| `tdarr-server-0` | `tdarr` | `k3s-node-3` | Server could not finish startup because SQLite writes failed |
| `tdarr-worker-*` | `tdarr` | `k3s-node-3` | Worker remained blocked in init container waiting for server health |
| `server-tdarr-server-0` PVC | `tdarr` | Longhorn volume on `k3s-node-3` | Existing `5Gi` volume was full |

## Root Cause

The Tdarr server data PVC (`server-tdarr-server-0`) filled up. The largest persisted data was under `/app/server/Tdarr`:

| Path | Size |
|------|------|
| `/app/server/Tdarr/DB2/JobReports` | `3.9G` |
| `/app/server/Tdarr/Backups` | `771M` |
| `/app/server/Tdarr/DB2/SQL` | `273M` |

The intended Git change had already increased the StatefulSet `volumeClaimTemplates` size from `5Gi` to `10Gi`, but that did not resize the existing PVC. Kubernetes does not allow in-place updates to most StatefulSet spec fields, including `spec.volumeClaimTemplates`, so ArgoCD failed with:

```text
StatefulSet.apps "tdarr-server" is invalid: spec: Forbidden: updates to statefulset spec for fields other than 'replicas', 'ordinals', 'template', 'updateStrategy', 'revisionHistoryLimit', 'persistentVolumeClaimRetentionPolicy' and 'minReadySeconds' are forbidden
```

The existing PVC stayed at `5Gi` while Git declared the template as `10Gi`, creating drift. Once Tdarr's job report/database data consumed the remaining space, SQLite writes failed and the server never became healthy.

## Fix Steps

| Step | Action |
|------|--------|
| 1 | Confirmed `tdarr-server-0` startup failures and `SQLITE_IOERR` in server logs. |
| 2 | Confirmed `/app/server` was `100%` full while `/app/configs` and `/app/logs` had free space. |
| 3 | Confirmed live `server-tdarr-server-0` PVC was still `5Gi`, while Git manifest requested `10Gi`. |
| 4 | Confirmed `longhorn` StorageClass has `allowVolumeExpansion: true`. |
| 5 | Expanded the existing PVC in place: `kubectl -n tdarr patch pvc server-tdarr-server-0 --type merge -p '{"spec":{"resources":{"requests":{"storage":"10Gi"}}}}'`. |
| 6 | Waited for Longhorn and kubelet filesystem expansion to complete. PVC capacity became `10Gi`; mounted ext4 filesystem became `9.8G` with `5.0G` free. |
| 7 | Deleted only the StatefulSet controller with orphaning: `kubectl -n tdarr delete statefulset tdarr-server --cascade=orphan`. This preserved the pod and PVCs. |
| 8 | Recreated the StatefulSet from Git: `kubectl apply -f manifests/tdarr/server-statefulset.yaml`. The new StatefulSet template now declares `10Gi`. |
| 9 | Verified `tdarr-server-0` became `1/1 Running`. |
| 10 | Verified `tdarr-worker-*` became `1/1 Running` and registered with the server. |

## Verification

- `server-tdarr-server-0` PVC capacity: `10Gi`.
- Mounted `/app/server` filesystem: `9.8G`, `4.9G used`, `5.0G available`, `50%`.
- `tdarr-server-0`: `1/1 Running`.
- `tdarr-worker-*`: `1/1 Running`.
- Tdarr logs after expansion showed normal startup, WebUI listening, plugin update checks, folder watchers starting, and worker registration.
- Live StatefulSet `server` volumeClaimTemplate reports `10Gi`.
- Tdarr `jobHistorySizeLimitGB` was later reduced from `10` to `7` through the WebUI and verified in `settingsglobaljsondb`.

## Remaining Caveat

ArgoCD workload health became `Healthy`, but the application sync status was still `Unknown` at the last check because ArgoCD could not fetch GitHub:

```text
ComparisonError: Failed to load target state: failed to generate manifest for source 1 of 1: rpc error: code = Unknown desc = Get "https://github.com/kavishwar-khankari/kubernetes-homelab.git/info/refs?service=git-upload-pack": context deadline exceeded
```

The old failed sync operation message may remain visible until ArgoCD completes a successful Git comparison/sync.

## Prevention

- [ ] Add an operational runbook note: for StatefulSet PVC growth, patch the existing PVC first, then orphan/recreate the StatefulSet controller so the immutable template matches Git.
- [ ] Monitor PVC usage for `server-tdarr-server-0`; alert before `/app/server` exceeds 80%.
- [x] Reduce Tdarr job report retention/size limit. It was changed to `7GiB`; current reports are still below that limit, so existing reports were not deleted immediately.
- [ ] Avoid relying on changing `volumeClaimTemplates` alone for existing StatefulSet volumes; it only affects newly created claims and cannot be applied in place.
- [ ] Recheck ArgoCD `tdarr` sync once GitHub fetches recover.

## References

- Kubernetes PVC expansion: https://kubernetes.io/docs/concepts/storage/persistent-volumes/#expanding-persistent-volumes-claims
- Kubernetes volume expansion GA notes: https://kubernetes.io/blog/2022/05/05/volume-expansion-ga/
- Longhorn volume expansion: https://longhorn.io/docs/1.8.1/nodes-and-volumes/volumes/expansion/
