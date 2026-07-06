# Incident 006: qBittorrent ingress 502 from stale lockfile

**Date:** 2026-07-06
**Detected:** Browser showed `502 Bad Gateway` for `https://qbittorent.techtronics.top/`
**Resolved:** 2026-07-06
**Severity:** Medium (qBittorrent WebUI unavailable; other `vpn-torr` apps healthy)

## Symptoms

- `https://qbittorent.techtronics.top/` returned nginx `502 Bad Gateway`.
- Other services in the same `vpn-torr` pod, including JDownloader, worked.
- `vpn-torrent` pod showed `7/7 Running`, so Kubernetes considered the pod healthy.
- qBittorrent service and ingress existed and had endpoints.
- Inside the pod:
  - `127.0.0.1:9090` returned connection refused.
  - `jdownloader2` on `127.0.0.1:5800` returned HTTP 200.
- qBittorrent supervisor showed:
  - `down (exitcode 0), want up`
- qBittorrent logs repeatedly showed:
  - `qBittorrent v5.2.0 started`
  - `Using config directory: /config/qBittorrent`
  - `qBittorrent termination initiated`
  - `qBittorrent is now ready to exit`

## Affected

| Resource | Namespace | Node | Impact |
|----------|-----------|------|--------|
| `qbittorrent` container | `vpn-torr` | `k3s-node-2` | WebUI process exited immediately |
| `qbittorrent` Service | `vpn-torr` | cluster-wide | Endpoint existed but port `9090` refused connections |
| `vpn-torr-ingress` host `qbittorent.techtronics.top` | `vpn-torr` | ingress nodes | Returned `502` |

## Root Cause

The qBittorrent config PVC contained a stale lockfile from an old pod instance:

```text
/config/qBittorrent/lockfile
old pod: vpn-torrent-86584dffbf-9m4wf
current pod: vpn-torrent-86584dffbf-8djzt
```

After the `vpn-torr` pod was recreated, qBittorrent started with persisted config, detected the stale instance lock, and exited cleanly with code `0`. The container stayed alive because linuxserver's s6 supervisor kept running, so Kubernetes still marked the pod/container healthy even though no qBittorrent WebUI was listening on `9090`.

The issue surfaced suddenly because the pod was recreated and the manifest uses the floating image tag `lscr.io/linuxserver/qbittorrent:latest`, currently running qBittorrent `v5.2.0`.

## Fix Steps

| Step | Action |
|------|--------|
| 1 | Verified ingress and service pointed at `qbittorrent:9090`. |
| 2 | Verified the `vpn-torr` pod and other containers were healthy. |
| 3 | Tested inside the pod and confirmed `127.0.0.1:9090` was connection refused. |
| 4 | Confirmed `svc-qbittorrent` was down while the container remained running. |
| 5 | Found stale `/config/qBittorrent/lockfile` pointing to old pod `vpn-torrent-86584dffbf-9m4wf`. |
| 6 | Moved the stale lockfile aside to `/config/qBittorrent/lockfile.stale-20260706205817`. |
| 7 | Restarted qBittorrent service with `s6-svc -u /run/service/svc-qbittorrent`. |
| 8 | Verified `9090` was listening inside the pod. |
| 9 | Verified ClusterIP service returned HTTP 200. |
| 10 | Verified `https://qbittorent.techtronics.top/` returned HTTP 200. |

## Prevention

- [ ] Pin `lscr.io/linuxserver/qbittorrent` by digest instead of using `latest`.
- [ ] Add a qBittorrent readiness probe against port `9090` so Kubernetes does not report the pod fully ready when the WebUI process is down.
- [ ] If qBittorrent exits immediately with code `0`, check `/config/qBittorrent/lockfile` before restarting or recreating the whole pod.
- [ ] Only remove a qBittorrent lockfile after confirming no other qBittorrent process or pod is actively using the same config PVC.
