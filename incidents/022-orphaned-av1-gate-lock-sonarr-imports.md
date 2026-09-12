# Incident 022: Orphaned AV1 gate lock blocked all Sonarr imports

**Date:** 2026-09-11 to 2026-09-12
**Detected:** 2026-09-12
**Resolved:** 2026-09-12 14:33 IST (lock removed; imports flowed)
**Severity:** High (every import to the affected series failed for ~17 hours)

## Symptoms

- Sonarr logged `arr-av1-jellyfin-gate: timed out waiting for gate lock` every ~60 seconds for `[Trix] Sparks of Tomorrow` S01E01-E03 (165 occurrences).
- Queue items sat at 100% with "One or more episodes expected in this release were not imported or missing from the release".
- E04-E09 had imported fine at 21:39-21:40 the previous evening; E01-E03 never landed.
- No lock directory was visible from inside the Sonarr pod, yet the gate script kept failing.

## Affected

| Resource | Impact |
|---|---|
| Sonarr imports | E01-E03 blocked for ~17h; every retry burned a 60s gate timeout |
| `arr-av1-jellyfin-gate.sh` | `mkdir` returned EEXIST for the orphaned lock; the script had no recovery path |

## Root Cause

1. The gate script creates a lock directory (`.tdarr-av1-jellyfin-gate.lock`) in the destination folder, writes its PID to `.owner`, updates the `.ignore` marker, then releases the lock on exit.
2. An import run at 2026-09-11 21:42 created the lock directory but died before writing `.owner`, leaving an empty lock and an orphan `..ignore.tdarr-gate.<pid>.<ts>.tmp` file (the exact interruption trigger is unknown).
3. The script marked the lock as "acquired" only after the owner write, so its EXIT trap never removed the orphan. It also had no stale-lock detection.
4. Every retry: `mkdir` -> EEXIST -> 60 attempts -> `timed out waiting for gate lock`.
5. Sonarr's mergerfs view did not list the lock (`readdir` caching), which hid the cause during first-line debugging; the raw CIFS view from the node hosts showed it immediately.

## Fix Steps

| Step | Action |
|------|--------|
| 1 | Listed the directory through node 2's raw CIFS mount (`/mnt/nas/media`), bypassing the mergerfs cache; found the empty lock and orphan tmp file. |
| 2 | Removed the lock with `rmdir` from the Sonarr pod (name-based syscall, unaffected by the stale readdir cache); verified removal through node 1's raw CIFS mount. |
| 3 | The next gate run updated `.ignore` at 14:33; the Sonarr queue emptied and E01-E03 appeared in the library. |
| 4 | Hardened the script in git (commit `81e6d5c`): set the acquired flag immediately after `mkdir` succeeds, and reclaim locks whose `.owner` is missing or whose PID is no longer alive after a 5-second grace period. |
| 5 | Removed the orphan tmp file from the share via TrueNAS. |

## Prevention

- [x] Script hardening deployed through ArgoCD (`manifests/arrs/gate-script-configmap.yaml` and `manifests/tdarr/script-source/` kept in sync).
- [ ] When diagnosing hostPath media paths, bypass mergerfs and inspect the raw CIFS mount on a node; the pod-visible view can serve stale directory listings.
- [ ] Consider logging a clear heartbeat when a gate lock is reclaimed so monitoring can surface it.

## Related

- Incident 009 (SMB naming and ACL failures on the same share)
- Incident 021 (share-name mismatch on the same share)
