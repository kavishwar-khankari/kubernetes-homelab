# Incident 021: Tdarr hostPath failed after TrueNAS dropped share media_2

**Date:** 2026-09-04
**Detected:** 2026-09-04 13:40 UTC
**Resolved:** 2026-09-04 14:00 UTC
**Severity:** High (Tdarr could not start on node 3; Jellyfin on node 3 saw cloud-only mergerfs)

## Symptoms

- Tdarr server/worker on `k3s-node-3` stuck `FailedMount`: `hostPath type check failed: /mnt/nas/media is not a directory`.
- SSH on node 3: `ls: cannot access '/mnt/nas/media': No such file or directory`.
- systemd still reported `mnt-nas-media.mount`, `mergerfs-media.service`, and `rclone-mount.service` active since 2026-08-19.
- Jellyfin `/media_2` listed 5 dirs (cloud branch) instead of ~38 NAS dirs.
- Kernel: `CIFS: VFS: \\192.168.0.75\media_2 reconnect tcon failed rc = -2` (ENOENT).

## Affected

| Resource | Node | Impact |
|----------|------|--------|
| `tdarr-server`, `tdarr-worker` | k3s-node-3 | hostPath `/mnt/nas/media` unusable; pods could not start |
| `mnt-nas-media.mount` | k3s-node-3 | Ghost CIFS mount, tcon `DISCONNECTED` (`Status: 4`, `tid: 0x0`) |
| `jellyfin`, `silo` | k3s-node-3 | mergerfs stayed up on rclone only |
| Nodes 1 and 2 | k3s-node-1, k3s-node-2 | Live leftover `media_2` sessions; would fail on reconnect |

## Root Cause

1. Node systemd units and SMB CSI PVs used `//192.168.0.75/media_2/media`.
2. The TrueNAS share named `media_2` was removed. Remaining share is `media` → `/mnt/TANK_2/media_2/media`.
3. Node 3's CIFS tree connect dropped (Tdarr was already hung on that path). Reconnect failed because share `media_2` no longer exists.
4. systemd kept the unit `active (mounted)` while VFS returned ENOENT, so kubelet `hostPath type: Directory` failed.
5. Nodes 1/2 kept pre-deletion SMB sessions (`Status: 1`) and looked healthy until remount.

## Fix Steps

| Step | Action |
|------|--------|
| 1 | Confirmed node 3 CIFS `media_2` DISCONNECTED; nodes 1/2 still Status 1 on `media_2`; rclone/mergerfs still mounted. |
| 2 | Pointed `mnt-nas-media.mount` `What=` at `//192.168.0.75/media` on all three nodes (share `media` already is `/mnt/TANK_2/media_2/media`; do not append `/media`). |
| 3 | Lazy-unmounted the ghost CIFS mount and restarted `mnt-nas-media.mount`. `findmnt` showed `cifs //192.168.0.75/media`; ~38 dirs. |
| 4 | Restarted `mergerfs-media.service` on all three nodes. |
| 5 | Recreated hostPath pods: jellyfin, silo, tdarr-server, tdarr-worker, arr-stack, frostbite, vpn-torrent. |
| 6 | Verified in-pod mounts: Tdarr/vpn CIFS `//192.168.0.75/media` 8.7T; Jellyfin/arr/silo/frostbite mergerfs ~18T / 39 dirs. |

## Recurrence: 2026-09-11 — cluster reboot exposed six SMB CSI PVs still on `media_2`

### Symptoms

- Full-cluster reboot cleared the leftover node 1/2 `media_2` sessions.
- `immich-server` and `minio` stuck; `FailedMount` with `mount failed: exit status 32` on `//192.168.0.75/media_2/media`.
- Cascade: Loki and all Mimir components crashlooped on `minio.monitoring.svc:9000 connection refused`.

### Root Cause

1. Six static SMB CSI PVs still declared `source: //192.168.0.75/media_2/media` (immich, minio, jellyfin, arrs, tdarr, vpn-torr).
2. `kubectl apply --dry-run=server` proved `spec.persistentvolumesource` is immutable, so the GitOps source change could not be applied in place.
3. Only immich and minio PVs were in active use; the other four were legacy leftovers.

### Fix Steps

| Step | Action |
|------|--------|
| 1 | Committed + pushed the six `storage.yaml` source changes (`//192.168.0.75/media`, minio adds `/monitoring/minio`). |
| 2 | Deleted the stuck `immich-server` and `minio` pods, then paused their Deployments briefly so PVC protection would release. |
| 3 | Deleted all six PVC+PV pairs (all `Retain`; data lives on the NAS SMB share, nothing lost). |
| 4 | ArgoCD self-heal recreated PVs and PVCs from git; both active pairs bound with the new source. |
| 5 | Verified MinIO sees `loki-chunks`/`mimir-blocks`; `immich-server` mounts `//192.168.0.75/media` at `/data`. |
| 6 | Reset backoff on `loki-0`, `mimir-ingester-0`, `mimir-ruler`; full monitoring stack recovered. |

### Additional client: Asus Vivobook laptop (2026-09-12)

The laptop's `/etc/fstab` still mounted `//192.168.0.75/media_2/media` at `/home/pico/media`, so every access failed (`mount error(2): No such file or directory`, unit `home-pico-media.mount` failed) and Dolphin surfaced an "Authorization required" banner. The `big_data` mount using the same credentials file worked, proving credentials and network were healthy.

| Step | Action |
|------|--------|
| 1 | Updated `/etc/fstab` to mount `//192.168.0.75/media` at `/home/pico/media` (backup at `/etc/fstab.bak`). |
| 2 | Ran `systemctl daemon-reload`, restarted `home-pico-media.automount`, and reset the failed mount unit. |
| 3 | Verified the mount is active, `ls /home/pico/media` lists the library, and `findmnt` shows source `//192.168.0.75/media`. |

### Prevention

- [x] GitOps-update SMB CSI PV `source` to `//192.168.0.75/media` (committed `a29e86b`).
- [ ] After any TrueNAS share rename/delete, remount node CIFS **and** recreate hostPath pods (incident 014 class).
- [ ] Alert on CIFS `reconnect tcon failed` and on `hostPath type check failed` for `/mnt/nas/media`.
- [ ] Remember PV `spec.persistentvolumesource` is immutable — plan a PVC+PV recreate (not a patch) for future source changes.
- [ ] Audit non-cluster clients (laptops, PCs) for stale `media_2` fstab entries after any TrueNAS share change.

## Related

- Incident 009 (CIFS/mergerfs hostPath fallback)
- Incident 014 (stale hostPath bind after mergerfs restart)
- Incident 019 (stale CIFS on node 3)
