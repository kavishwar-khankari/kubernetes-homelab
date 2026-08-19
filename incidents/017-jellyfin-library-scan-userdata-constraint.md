# Incident 017: Jellyfin library scan aborted by stale UserData rows

**Date:** 2026-08-18 to 2026-08-19
**Detected:** 2026-08-18 21:08 IST
**Resolved:** 2026-08-19 14:24 IST
**Severity:** Medium (new media was not added to the library; existing playback was separate)

## Symptoms

- Radarr placed `Toy Story 5 (2026)` at the expected `/media_2/001.MOVIES` path.
- The file was readable from both the Arr and Jellyfin pods and passed `ffprobe`.
- Jellyfin's full library scan reported `Completed`, but the new movie and other newer folders were not indexed.
- The scan logged `SQLite Error 19: 'UNIQUE constraint failed: UserData.ItemId, UserData.UserId, UserData.CustomDataKey'`.

## Affected

| Resource | Node | Impact |
|----------|------|--------|
| `jellyfin` Deployment | k3s-node-3 | Movies library scan stopped adding newly discovered media |
| `jellyfin-config` PVC | k3s-node-3 | Jellyfin database contained conflicting stale user-data rows |

## Root Cause

Jellyfin 10.11.11 retained a stale `Kung Fu Panda 4 (2024)` database item for a file that no longer existed while also retaining a newer item in the same folder. Both movie items had playback data and the same metadata key.

During the scan, Jellyfin attempted to tombstone the stale folder and descendants by rewriting their `UserData.ItemId` values to the shared tombstone ID. The duplicate `(UserId, CustomDataKey)` values made that update violate the SQLite uniqueness constraint. Jellyfin aborted the library operation before adding new media. This is the known Jellyfin 10.11.x bug tracked upstream in issues 15343, 15658, and 16975.

## Fix Steps

| Step | Action |
|------|--------|
| 1 | Committed and pushed a temporary ArgoCD-managed maintenance Job and set the Deployment replicas to zero. |
| 2 | ArgoCD stopped Jellyfin and mounted `jellyfin-config` in the tracked Job. |
| 3 | Created `/config/data/data/jellyfin.db.before-kfp-repair-20260819`. |
| 4 | Deleted the 16 targeted `UserData` rows for the affected folder and movie items. No media files were deleted. |
| 5 | Ran SQLite `PRAGMA integrity_check`; result was `ok`. |
| 6 | Removed the temporary Job and restored `replicas: 1` through separate Git commits. ArgoCD returned to `Synced / Healthy`. |

## Prevention

- Upgrade to a stable Jellyfin release containing the upstream fix when available.
- Alert on `UNIQUE constraint failed: UserData.ItemId` and `Error while performing a library operation` in Jellyfin logs.
- Keep the repair backup until the library rescan has been verified.
- Use targeted `UserData` cleanup with a database backup; do not delete `BaseItems` rows directly.
- Run a library scan after the repair and verify that new media is indexed. This verification remains pending.

## Related

- Incident 014: stale mergerfs hostPath bind causing `Transport endpoint is not connected` playback failures.
- Jellyfin transcode throttling remains enabled separately and was not changed by this repair.
