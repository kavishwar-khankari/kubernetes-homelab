# Incident 020: Tdarr Jellyfin gate invalid file timestamps

**Date:** 2026-09-01  
**Detected:** 2026-09-01 during Jellyfin Android playback failures  
**Resolved:** 2026-09-01 after the gate rollout and timestamp repair  
**Severity:** High (49 current media files could not be served by Jellyfin direct play)

## Symptoms

- Jellyfin for Android returned an error while starting direct playback.
- Jellyfin logged `ArgumentOutOfRangeException` from `PhysicalFileResultExecutor.GetFileInfo` while serving `/Videos/{id}/stream`.
- The media files were valid AV1 files, but their filesystem access and modification timestamps were in the year 30828.

## Affected

- Tdarr AV1 Jellyfin gate on `k3s-node-3`.
- 35 existing files under the Tdarr `/media` anime, web-series, and movie roots.
- 14 additional current files under Jellyfin's `/media_2` merged view. They were initially absent from Tdarr's `/media` view because the pods mount `/mnt/nas/media` and `/mnt/merged/media`, respectively.
- Rick and Morty Season 8 files had valid timestamps because their jobs ran before the web-series gate activation; they were not modified.

## Root Cause

The gate deliberately touched the final file to emit a filesystem event and then restored its timestamps with:

```js
fs.utimesSync(filePath, stat.atimeMs, stat.mtimeMs);
```

`atimeMs` and `mtimeMs` are milliseconds. Numeric arguments to `fs.utimesSync` are interpreted as seconds. This multiplied the effective timestamp by 1,000 and produced values such as `910692730085000` milliseconds, which Jellyfin could not convert into a valid HTTP `Last-Modified` value.

## Fix Steps

1. Changed the gate to pass `stat.atime` and `stat.mtime` `Date` objects.
2. Mirrored the change in the GitOps ConfigMap and added a timestamp-preservation regression test.
3. Committed and pushed the fix as `f2f0f35`; ArgoCD reconciled it and both Tdarr server and worker loaded the corrected plugin.
4. Used the `fileVersionOriginalLogJSONString` entry in the latest successful Tdarr job report for each affected path to recover the pre-gate timestamps. The final output entry was used only to validate the current file size, including for the 14 paths mapped from Tdarr `/media` to Jellyfin `/media_2`.
5. Applied only `atime` and `mtime` repairs to all 49 current files. Media content, ownership, permissions, and Jellyfin metadata were not changed.
6. Verified the repaired inventory has zero invalid timestamps and representative movie, anime, Rick and Morty, and The Bad Guys files return HTTP `206` from Jellyfin.
7. Refreshed all 3,473 managed Tdarr `FileJSONDB` records through the supported `rescan-file` API. An initial unthrottled batch OOM-killed the Tdarr server once; the retry was rate-limited and completed without another restart.

## Prevention

- [x] Pass `Date` objects to `fs.utimesSync`.
- [x] Keep a regression test that verifies timestamps survive a successful gate release.
- [x] Require an exact path and matching file size before any timestamp recovery operation.
- [x] Select the latest successful job when a path has been processed more than once.
- [x] Recover from the original pre-transcode report entry, never the final post-restore entry.
- [x] Check both Tdarr and Jellyfin mount views before classifying a historical path as missing.
- [x] Rate-limit per-file Tdarr metadata rescans after a bulk timestamp repair.
