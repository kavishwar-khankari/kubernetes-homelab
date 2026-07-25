# Incident 009: Arr imports blocked by inaccessible NAS content

**Date:** 2026-07-19, 2026-07-25
**Detected:** 2026-07-19  
**Resolved:** 2026-07-19  
**Severity:** High (all Arr imports on node 2 blocked; hostPath exposed an empty local fallback)  

## Symptoms

- Sonarr downloads remained in `Downloaded - Waiting to Import`.
- Sonarr reported `path does not exist or is not accessible` for completed files under `/media_2/qbittorent`.
- qBittorrent reported the same files as complete at the expected `/media_2/qbittorent` path.
- The six-container `arr-stack` pod remained `Running` and ready despite seeing the wrong filesystem.
- Inside Sonarr, `/media_2` and `/downloads` initially reported an ext filesystem instead of mergerfs, and completed NAS files were absent.

## Affected

| Resource | Node | Impact |
|----------|------|--------|
| `arr-stack` Deployment | `k3s-node-2` | Sonarr, Radarr, and Lidarr could not see new NAS downloads |
| `mnt-nas-media.mount` | `k3s-node-2` | CIFS mount failed with `mount error(13): Permission denied` |
| `mergerfs-media.service` | `k3s-node-2` | Remained inactive because the CIFS dependency failed |
| `/mnt/merged/media` hostPath | `k3s-node-2` | Exposed the underlying empty local directory to the pod |

Nodes 1 and 3 still had healthy CIFS and mergerfs mounts, but their local credential files were also stale and would have failed on the next SMB reauthentication.

## Root Cause

1. `/etc/.smbcreds` on the Kubernetes nodes had not been refreshed after the authoritative Doppler-managed SMB credentials changed.
2. Node 2 attempted to mount `//192.168.0.75/media_2/media` on 2026-07-16 and TrueNAS rejected the stale credentials with `Permission denied`.
3. `mergerfs-media.service` requires both `mnt-nas-media.mount` and `rclone-mount.service`, so the failed CIFS mount prevented the union filesystem from starting.
4. The Arr Deployment uses `hostPath` volumes with `type: Directory`. Kubernetes therefore accepted the underlying local directories and marked the pod healthy even though the expected CIFS and mergerfs mounts were absent.
5. Moving qBittorrent to TrueNAS did not cause the SMB authentication failure. It exposed the existing node-2 failure because qBittorrent correctly wrote files to the NAS while Sonarr read from node 2's empty fallback path.

## Fix Steps

| Step | Action |
|------|--------|
| 1 | Confirmed qBittorrent and Sonarr used the same `/media_2/qbittorent` content path. |
| 2 | Verified `/mnt/nas/media` and `/mnt/merged/media` were not mounted on node 2, while both were healthy on node 3. |
| 3 | Found `mnt-nas-media.mount` failed with SMB `Permission denied` and `mergerfs-media.service` failed its dependency. |
| 4 | Atomically refreshed `/etc/.smbcreds` on all three nodes from the current `arr-stack/smbcreds-arr-stack` Secret without printing credential values. |
| 5 | Restored `mnt-nas-media.mount` on node 2, then started `mergerfs-media.service` after confirming rclone was active. |
| 6 | Verified all three nodes had active CIFS and mergerfs mounts and credential files with mode `0600`, owned by root. |
| 7 | Confirmed completed files became visible through Sonarr's `/media_2` mount. Sonarr immediately imported the valid video files and correctly rejected `.exe` and `.scr` payloads. |
| 8 | Recreated the Arr pod so `/media_2` and `/downloads` both bound to the restored mergerfs filesystem. All six containers returned ready. |
| 9 | Changed qBittorrent's share-limit action from remove-with-content to stop while retaining ratio `10` and inactive seeding limit `1440` minutes. |

## Prevention

- [x] Refresh SMB credential files on all three nodes from the current Doppler-managed Secret.
- [x] Verify CIFS and mergerfs mounts on all three nodes after credential repair.
- [x] Recreate the Arr pod after mount recovery so existing hostPath and subPath binds cannot retain fallback directories.
- [x] Configure qBittorrent to stop, not delete content, when share limits are reached.
- [ ] Automate node credential synchronization when Doppler rotates `SMB_USER` or `SMB_PASSWORD`.
- [ ] Add node monitoring and alerts for failed `mnt-nas-media.mount` and `mergerfs-media.service` units.
- [ ] Add an Arr startup check that refuses to start unless `/mnt/merged/media` is a mergerfs mount and `/mnt/nas/media` is CIFS-backed.
- [ ] Avoid writable fallback directories beneath critical hostPath mountpoints, or replace these hostPath volumes with storage resources whose mount failures keep the pod unready.

## Recurrence: 2026-07-25

After TrueNAS disk replacement maintenance, Sonarr again reported `Downloaded - Waiting to Import`, but the CIFS and mergerfs mounts were healthy. qBittorrent successfully rechecked the affected torrents and could read their payloads directly on TrueNAS, while Sonarr and desktop SMB clients saw the same download directories as empty.

The qBittorrent container and TrueNAS host reported the same ZFS filesystem ID, ruling out a stale bind mount. The files existed on the dataset with mode `0666`, but newly-created parent directories inherited a POSIX ACL with `other::rw-`. The SMB user was not covered by the owner or `apps` group entries and lacked directory execute (`x`) permission, which is required to traverse and stat files. A direct `sudo -u kavi ls` reproduced `Permission denied` for every entry.

The immediate fix added an access and default ACL for the SMB user to the affected directory. The permanent targeted fix applied `user:kavi:rwx` access and default ACL entries to directories under `/mnt/TANK_2/media_2/media/qbittorent`. Sonarr immediately saw the payload files through CIFS/mergerfs and resumed importing without another download.

For future occurrences, distinguish the two failure modes before changing mounts:

- Wrong filesystem type or missing root directories inside the pod indicates the original CIFS/mergerfs mount failure.
- Correct CIFS/mergerfs filesystem types with visible-but-empty download directories indicates server-side traversal or ACL failure; compare container, TrueNAS host, and SMB-user views.
