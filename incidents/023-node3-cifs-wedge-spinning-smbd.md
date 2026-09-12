# Incident 023: Node-3 CIFS wedge stalled Jellyfin and spun an orphaned smbd on TrueNAS

**Date:** 2026-09-12
**Detected:** 2026-09-12 ~14:00 IST
**Resolved:** 2026-09-12 15:38 IST (reboots cleared stuck state; TrueNAS back to idle)
**Severity:** High (Jellyfin library scan stuck; Tdarr unable to read media; TrueNAS burned a full CPU core)

## Symptoms

- Jellyfin's "Scan Media Library" stuck at 41% indefinitely; newly imported media never appeared.
- `ls` on `/media_2/series/anime/Sparks of Tomorrow/Season 1` hung from node 3 - from the Jellyfin container, the Tdarr container, and the node 3 host - while nodes 1 and 2 listed it instantly.
- A `Tdarr_Node` process on node 3 had been in uninterruptible D-state since ~04:28.
- TrueNAS CPU rose to 45% with one core pinned at 100%; `top` showed `smbd: client [192.168.0.163]` in D-state at 100% CPU with ~15 CPU-hours accumulated, absent from `smbstatus -p` (orphaned worker).
- CIFS `reconnect tcon failed rc = -2` messages continued from the previous day's share-mismatch incident.

## Affected

| Resource | Impact |
|---|---|
| `k3s-node-3` CIFS client | Stat/readdir on some paths hung; several processes stuck in D-state |
| Jellyfin (node 3) | Library scan stuck; no new media |
| Tdarr server/worker (node 3) | Media reads hung; stale worker processes |
| TrueNAS | One `smbd` worker spinning at ~100% CPU (~15 CPU-hours) |

## Root Cause

1. Node 3's CIFS session to `//192.168.0.75/media` wedged: some operations succeeded, while stat/readdir on recently created directories never completed.
2. The blocked client processes (Tdarr_Node and diagnostic `ls` commands) could not be killed (D-state) and pinned the old SMB session, so it never tore down.
3. Server-side, the `smbd` worker for that session became stuck in a kernel loop consuming a full core; it was already orphaned from Samba's session table and survived an SMB service restart.
4. The exact trigger for the wedge is unknown; it followed the previous day's TrueNAS share removal and remount churn.

## Fix Steps

| Step | Action |
|------|--------|
| 1 | Lazy-unmounted `/mnt/nas/media` on node 3 and restarted `mnt-nas-media.mount`; the previously hanging directory listed instantly. |
| 2 | Restarted `mergerfs-media.service` and recreated the node-3 media pods (jellyfin, tdarr-server, tdarr-worker); force-deleted pods whose termination hung on D-state processes. |
| 3 | Removed the orphaned `..ignore.tdarr-gate.*.tmp` file from the share via TrueNAS. |
| 4 | Rebooted all three nodes and TrueNAS to clear unkillable D-state processes and the orphaned server-side `smbd`. |
| 5 | Verified: zero D-state processes, all pods ready, all node mounts healthy, TrueNAS load ~1 with no `smbd` spinner, and 8 clean SMB sessions. |

## Prevention

- [ ] Alert on D-state process accumulation and CIFS reconnect failures (still open from incidents 014 and 019).
- [x] After any mount restart on a node, recreate hostPath pods so no stale bind survives (incident 014 rule) - done here.
- [ ] Investigate whether `cache=strict` plus frequent directory churn triggers session wedges; evaluate mount option changes or NFS for the media path (open item from incident 009).
- [ ] If a client-side wedge recurs, check TrueNAS `top` for a spinning `smbd` early; plan an SMB restart or reboot instead of chasing clients.

## Related

- Incident 014 (stale hostPath bind after mergerfs restart)
- Incident 019 (stale CIFS amplified by Longhorn sync)
- Incident 021 (share mismatch after TrueNAS share removal)
