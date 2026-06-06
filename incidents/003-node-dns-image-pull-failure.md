# Incident 003: Node DNS failure causing image pull failures

**Date:** 2026-06-06  
**Detected:** 2026-06-06 during Tachidesk/Suwayomi auth rollout  
**Resolved:** 2026-06-06  
**Severity:** Medium (new image pulls on k3s-node-2 failed; Tachidesk unavailable during rollout)  

## Symptoms

- `tachidesk` rollout created a new pod on `k3s-node-2` that stayed in `ErrImagePull` / `ImagePullBackOff`.
- Kubelet events showed registry DNS lookup failures:

  ```text
  failed to resolve reference "ghcr.io/suwayomi/suwayomi-server@sha256:...":
  Head "https://ghcr.io/v2/suwayomi/suwayomi-server/manifests/sha256:...":
  dial tcp: lookup ghcr.io on 127.0.0.53:53: read udp 127.0.0.1:...->127.0.0.53:53: read: connection refused
  ```

- The node itself was still `Ready`, and existing workloads continued running.
- Host DNS checks on `k3s-node-2` showed `/etc/resolv.conf` pointed at the `systemd-resolved` stub, but `systemd-resolved` was inactive:

  ```text
  /etc/resolv.conf -> ../run/systemd/resolve/stub-resolv.conf
  nameserver 127.0.0.53
  systemd-resolved: inactive (dead)
  ```

## Affected

| Resource | Namespace | Node | Impact |
|----------|-----------|------|--------|
| `tachidesk-*` pod | tachidesk | k3s-node-2 | Could not pull pinned `ghcr.io/suwayomi/suwayomi-server` image |
| Any new pod requiring uncached images | any | k3s-node-2 | Would fail image pulls until host DNS was restored |

## Root Cause

1. `systemd-resolved` on `k3s-node-2` had stopped two days earlier while `/etc/resolv.conf` still pointed to the local stub resolver at `127.0.0.53`.

2. Restarting `systemd-resolved` initially failed with:

   ```text
   Failed to allocate directory watch: Too many open files
   ```

   The node had exhausted inotify watch capacity, preventing `systemd-resolved` from starting.

   Inotify limits are per kernel UID, not per Kubernetes workload. Many host daemons and container processes run as UID 0, so root-owned processes across kubelet, containerd, Cilium, Longhorn, monitoring agents, and root-running containers share the same inotify pool. Once the default Ubuntu limits are exhausted, unrelated system services can fail to start.

3. After raising inotify limits and starting `systemd-resolved`, the service had no upstream DNS servers because the primary link `enp6s18` was unmanaged by both `systemd-networkd` and `NetworkManager`. `resolvectl status` showed no DNS scopes and `ghcr.io` failed with:

   ```text
   No appropriate name servers or networks for name found
   ```

## Fix Steps

| Step | Action |
|------|--------|
| 1 | Raised runtime inotify limits: `fs.inotify.max_user_watches=1048576`, `fs.inotify.max_user_instances=8192`, `fs.inotify.max_queued_events=65536` |
| 2 | Restarted `systemd-resolved` successfully |
| 3 | Added runtime DNS on `enp6s18`: `192.168.0.1`, `1.1.1.1`, `8.8.8.8`; set `~.` domain and default route |
| 4 | Deleted the failed Tachidesk pod so the Deployment retried image pull |
| 5 | Verified the pinned Suwayomi image pulled and Tachidesk rolled out successfully |
| 6 | Persisted inotify limits in `/etc/sysctl.d/99-inotify-limits.conf` |
| 7 | Persisted global `systemd-resolved` DNS in `/etc/systemd/resolved.conf.d/99-homelab-dns.conf` |

## Prevention

- [x] Persistent inotify limits added on `k3s-node-2`.
- [x] Persistent fallback DNS configured for `systemd-resolved` on `k3s-node-2`.
- [x] Tachidesk deployment verified healthy after repair: pod `1/1 Running`, rollout complete, HTTPS ingress returned `HTTP/2 200`.
- [ ] Apply persistent inotify limits on `k3s-node-1`; SSH startup failed with the same `Failed to allocate directory watch: Too many open files` symptom.
- [ ] Apply persistent inotify limits on `k3s-node-3`; DNS currently works, but the node still had Ubuntu defaults (`125446` watches, `512` instances, `16384` queued events).
- [ ] Audit `k3s-node-1` host DNS after SSH is restored.
- [ ] Consider monitoring host DNS health or image pull failures so resolver failures are detected before application rollouts.
