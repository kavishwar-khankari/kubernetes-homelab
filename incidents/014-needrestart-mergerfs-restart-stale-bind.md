# Incident 014: Jellyfin playback dead after needrestart bounced mergerfs

**Date:** 2026-08-11
**Detected:** 2026-08-11 11:46 IST
**Resolved:** 2026-08-11 12:31 IST
**Severity:** High (all Jellyfin playback on node 3 failed; users waiting)

## Symptoms

- All Jellyfin stream requests failed with `Transport endpoint is not connected : '/media_2/...'` (first error 11:46:23 IST, e.g. The Rookie S04E12, The Odyssey, Kill Bill).
- Playback worked until ~11:44 IST (user was mid-episode), then every new stream/seek failed.
- `systemctl` showed `mergerfs-media.service`, `mnt-nas-media.mount`, and `rclone-mount.service` all **active** on the host.
- A library scan at 11:43:09 flooded "Unable to find linked item" warnings (mount already dead by then).
- Only node 3 (Jellyfin host) affected; node 2's arr-stack `/media_2` still served the live mergerfs union.

## Affected

| Resource | Node | Impact |
|----------|------|--------|
| `jellyfin` Deployment | k3s-node-3 | `/media_2` hostPath bind referenced a dead mergerfs mount object; all playback failed |
| `mergerfs-media.service` | k3s-node-3 | Cleanly stopped and restarted by needrestart at 06:13:42 UTC (11:43:42 IST) |

## Root Cause

1. Daily `unattended-upgrade` ran at 06:13:32 UTC and upgraded the **systemd** package family (`systemd`, `libsystemd0`, `udev`, `libpam-systemd`, … 255.4-1ubuntu8.16 → .17).
2. Ubuntu's `needrestart` hook (installed, default policy) **auto-restarted `mergerfs-media.service`** 1 second after the transaction ended (06:13:42 UTC). Clean stop/start — `Result=success`, `NRestarts=0`, no kernel errors, no OOM.
3. The running Jellyfin pod (started Aug 7, before the restart) kept a bind to the **old, dead mergerfs mount object** (`mountPropagation: HostToContainer` adds new host mounts but does not re-point existing binds).
4. Host looked healthy (new mergerfs active); the pod's `/media_2` stayed dead until the pod was recreated.

## Evidence trail

- `systemctl show mergerfs-media.service` → `ActiveEnterTimestamp=2026-08-11 06:13:42 UTC`, `NRestarts=0` (not a `Restart=` policy restart → external stop/start).
- Journal: `Stopping → Deactivated successfully → Stopped → Starting → Started` at 06:13:42 UTC; no crash signature.
- `last -F` → **no SSH session existed at 11:43 IST** (only sessions at 12:24 IST from 192.168.0.162 and Aug 7) — not a human action.
- `/var/log/apt/history.log` → `Start-Date: 2026-08-11 06:13:32`, `Commandline: /usr/bin/unattended-upgrade`, `Upgrade: systemd … 255.4-1ubuntu8.17`, `End-Date: 06:13:41`.
- `dpkg -l needrestart` → `ii needrestart 3.6-7ubuntu4.5`.
- Timers cluster at 06:13 UTC (`apt-daily-upgrade` 06:13:27, `fwupd-refresh` 06:13:33, `man-db` 06:13:34) bracketed the restart.
- Node timezone is UTC; earlier `--since` queries used IST windows and returned "No entries" — timezone mismatch confused the initial read.

## Fix Steps

| Step | Action |
|------|--------|
| 1 | Confirmed NAS (192.168.0.75) reachable, SMB port 445 open; node systemd units active; `/mnt/merged/media` serving content (`teapot-media`, 15T). |
| 2 | Identified the pod-side bind as stale (`fuse.mergerfs` ro, ENOTCONN) while host mount was healthy. |
| 3 | Recreated the Jellyfin pod (`kubectl delete pod -n jellyfin -l app=jellyfin`). New pod bound the live mergerfs mount. |
| 4 | Verified `/media_2` in the new pod lists content and shows `teapot-media`; zero `Transport endpoint` errors after rollout. |
| 5 | Traced the restart to unattended-upgrade + needrestart via apt history, journal, and session logs. |
| 6 | Disabled needrestart auto-restarts (see Prevention) — pending on all three nodes. |

## Prevention

- [ ] Set `$nrconf{restart} = "l";` in `/etc/needrestart/conf.d/99-norestart.conf` on **all three nodes** (list-only: needrestart reports but never restarts services).
- [ ] Operational rule: after any manual or automatic restart of `mergerfs-media.service`/`rclone-mount.service` on a node, **recreate pods bound to `/mnt/merged/media`** on that node (jellyfin on node 3, arr-stack on node 2).
- [ ] Add a Jellyfin startup/readiness check that refuses ready unless `/media_2` resolves to the mergerfs union (same proposal as incident 009's Arr check).
- [ ] Consider replacing hostPath bind with a mount that fails the pod on disconnect, or add node-level alerting when `mergerfs-media.service` restarts (`journalctl -u` watch / Prometheus `systemd_unit_state`).

## Related

- Incident 009 (same stale-hostPath-bind failure class; different triggers: SMB creds / ACLs vs service auto-restart).
