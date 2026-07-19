# Incident 010: qBittorrent public API authentication bypass

**Date:** 2026-07-20  
**Detected:** During validation after restoring `qbittorent.techtronics.top`  
**Resolved:** 2026-07-20  
**Severity:** High (the public Web API allowed unauthenticated access)  

## Symptoms

- An unauthenticated request to `/api/v2/torrents/info` returned HTTP 200.
- An unauthenticated request to `/api/v2/app/preferences` exposed application preferences.
- The WebUI returned HTTP 200 without presenting its normal authentication boundary.
- The Kubernetes ingress, Service, pod, TLS certificate, and Proton tunnel were otherwise healthy.

## Affected

| Resource | Namespace | Impact |
|----------|-----------|--------|
| `qbittorrent-proton` | `vpn-torr` | WebUI authentication bypassed requests from the ingress |
| `vpn-torr-ingress` | `vpn-torr` | Exposed the unauthenticated API at `qbittorent.techtronics.top` |
| `qbittorrent-config` PVC | `vpn-torr` | Persisted the unsafe authentication preferences |

## Root Cause

The retained qBittorrent profile had both authentication bypass mechanisms enabled:

- `bypass_local_auth: true`
- `bypass_auth_subnet_whitelist_enabled: true`
- `bypass_auth_subnet_whitelist: 0.0.0.0/0`

The `0.0.0.0/0` whitelist matched every IPv4 source. Restoring the public ingress therefore exposed qBittorrent's Web API without requiring a login. The Kubernetes and Gluetun network boundaries did not provide application-level authentication.

## Fix Steps

| Step | Action |
|------|--------|
| 1 | Confirmed the public torrent and preferences API endpoints returned HTTP 200 without credentials. |
| 2 | Used the existing bearer API key inside the Gluetun sidecar to disable local-auth bypass and subnet-whitelist bypass. |
| 3 | Cleared the dormant `0.0.0.0/0` whitelist. |
| 4 | Verified unauthenticated API requests returned HTTP 403 while the WebUI login remained reachable. |
| 5 | Verified Gluetun could still authenticate with its API key and update qBittorrent's forwarded port. |
| 6 | Added the secure preferences to Gluetun's port-forwarding up command so every startup and port renewal reapplies them. |

## Prevention

- [x] Disable `bypass_local_auth` whenever qBittorrent is behind an ingress or reverse proxy.
- [x] Disable subnet authentication bypass and clear broad whitelist entries.
- [x] Enforce the authentication settings through the GitOps-managed Gluetun integration.
- [x] Test sensitive API endpoints without credentials before declaring an ingress rollout healthy.
- [ ] Review qBittorrent authentication preferences after future config restores or migrations.
