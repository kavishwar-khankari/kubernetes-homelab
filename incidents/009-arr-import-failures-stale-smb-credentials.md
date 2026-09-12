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
- [x] Enable Apple-style Character Encoding for SMB shares containing Linux-native filenames with SMB-reserved characters.
- [x] Fully restart the TrueNAS SMB service after changing share encoding, then reconnect affected CIFS clients.

## Recurrence: 2026-07-25

After TrueNAS disk replacement maintenance, Sonarr again reported `Downloaded - Waiting to Import`, but the CIFS and mergerfs mounts were healthy. qBittorrent successfully rechecked the affected torrents and could read their payloads directly on TrueNAS, while Sonarr and desktop SMB clients saw the same download directories as empty.

The qBittorrent container and TrueNAS host reported the same ZFS filesystem ID, ruling out a stale bind mount. The files existed on the dataset with mode `0666`, but newly-created parent directories inherited a POSIX ACL with `other::rw-`. The SMB user was not covered by the owner or `apps` group entries and lacked directory execute (`x`) permission, which is required to traverse and stat files. A direct `sudo -u kavi ls` reproduced `Permission denied` for every entry.

The immediate fix added an access and default ACL for the SMB user to the affected directory. The permanent targeted fix applied `user:kavi:rwx` access and default ACL entries to directories under `/mnt/TANK_2/media_2/media/qbittorent`. Sonarr immediately saw the payload files through CIFS/mergerfs and resumed importing without another download.

For future occurrences, distinguish the two failure modes before changing mounts:

- Wrong filesystem type or missing root directories inside the pod indicates the original CIFS/mergerfs mount failure.
- Correct CIFS/mergerfs filesystem types with visible-but-empty download directories indicates server-side traversal or ACL failure; compare container, TrueNAS host, and SMB-user views.

## Recurrence: 2026-08-17

After RDTC downloads moved to TrueNAS, Sonarr reported inaccessible paths such as `/media_2/rdtclient/tv-sonarr/[Onalrie] .../`. The TrueNAS filesystem contained the full directory names, while the Kubernetes CIFS view exposed Samba 8.3 aliases such as `_OEF0E~2`. The active client mount used SMB 3.1.1 but still displayed `nounix,mapposix`.

The TrueNAS share was changed to the Multi-protocol purpose with **Use Apple-style Character Encoding** enabled, and the SMB service was fully restarted. Node 2 was then reconnected and the affected Arr workloads were refreshed. The aliases disappeared from the Arr view and Sonarr imported the remaining files, including the previously failing Onalrie, Hanaori, Grand Blue, Smoking Behind the Supermarket with You, and Though I Am an Inept Villainess episodes.

The successful condition is the real long filenames being visible and imports succeeding; `nounix` may still appear in the Linux mount options. A client remount alone did not immediately clear the stale name view, while restarting SMB invalidated the server-side sessions and allowed the share encoding change to take effect.

## Recurrence: 2026-08-21

### Symptoms

- RDTClient running natively on TrueNAS with TorBox and the Bezzad downloader reported the completed torrent as finished.
- The TrueNAS filesystem contained all 12 video files, each approximately 6.3 GiB.
- Sonarr manual import reported `No video files were found in the selected folder`.
- The same directory appeared empty from the Kubuntu SMB mount, although other newly downloaded directories remained browsable.

### Affected

| Resource | Path or component | Impact |
|----------|------------------|--------|
| RDTClient | TrueNAS Portainer stack, `/data/downloads` | Wrote valid files directly to the ZFS dataset as `apps` (UID 568) |
| TrueNAS | `TANK_2/media_2/media/rdtclient` | Stored the files correctly; local POSIX access worked |
| Linux CIFS clients | Laptop SMB mount and Kubernetes Arr media mount | Could enumerate the affected directory but could not traverse it to list the video files |
| Sonarr | `/media_2/rdtclient/tv-sonarr` | Could not discover files for import |

### Root Cause

The affected torrent directory names ended with a trailing period:

```text
[CRUCiBLE] ... Fuufu Ijou, Koibito Miman.
16.Extremes.(Dhuruvangal.Pathinaaru).2016.1080p.WEB-DL.x264.AC3.
```

ZFS and Linux permit directory names ending in `.`. SMB and Windows-compatible path handling do not reliably support a trailing period in a path component. The Linux kernel CIFS client could therefore see the directory entry but could not enumerate its children.

The `|` in the first release name was a secondary SMB naming risk, but it was not the decisive cause. Replacing `|` with `-` did not fix the directory while the final `.` remained.

The following checks ruled out the earlier hypotheses:

1. `sudo -u kavi ls` on TrueNAS listed all 12 files.
2. A fresh authenticated `smbclient` session listed all 12 files with their correct sizes.
3. Changing ownership or the POSIX ACL mask was not required; the SMB user could already access the files.
4. Fresh CIFS mounts using different share paths, SMB 3.0/3.1.1, `reparse=none`, and `noserverino` still showed only the directory while its name ended in `.`.
5. A known-good directory without a trailing period was visible through the same CIFS mount.
6. After removing the trailing periods, the same CIFS mount exposed all 24 files from the two test copies, and Sonarr listed all 12 files for import.

### Fix Steps

1. Renamed the affected `tv-sonarr` directory to remove the final period.
2. Replaced the pipe in the separate root-level copy and removed its final period.
3. Remounted the laptop CIFS share.
4. Verified all files through the laptop mount.
5. Verified all 12 files from inside the Sonarr container.
6. Confirmed Sonarr manual import detected all 12 episodes.

No files were redownloaded, re-owned, or modified. The current operational workaround is to manually rename directories with trailing periods before importing them.

### Prevention

- [x] Remove trailing periods from the affected directories before Sonarr import.
- [ ] Sanitize trailing periods and spaces, plus SMB-reserved characters, in every completed torrent path component before exposing it to SMB clients.
- [ ] If using the RDTClient completion hook, pass `%R` so the sanitizer processes only the completed torrent rather than the entire downloads tree.
- [ ] Do not rely on `catia`, `mangled names`, or `mapposix` as the primary fix for trailing-dot paths; the tested TrueNAS/CIFS combination remained inconsistent.
- [ ] Evaluate NFSv4.2 for the Linux-only media path. NFS would preserve native POSIX names for the TrueNAS host, Kubernetes nodes, and the Linux laptop, but requires deliberate UID/GID mapping and an NFS CSI migration.
- [ ] If SMB remains in use, keep the share name/path policy documented and continue sanitizing names at the download boundary.
- [ ] Keep SMB and NFS writes disciplined if both protocols are enabled for the same dataset; use TrueNAS multi-protocol configuration rather than adding an unmanaged overlapping export.
