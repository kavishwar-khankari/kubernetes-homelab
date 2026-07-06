# Incident 005: Tailscale subnet router CrashLoopBackOff from invalid auth key

**Date:** 2026-07-06
**Detected:** Tailscale DaemonSet pods repeatedly restarting on node 1 and node 2
**Resolved:** 2026-07-06
**Severity:** Medium (Tailscale subnet routing unavailable or unstable)

## Symptoms

- `tailscale-subnet-router` pods on `k3s-node-1` and `k3s-node-2` entered `CrashLoopBackOff`.
- Both pods started `tailscaled`, attempted login, then exited with code `1`.
- Logs showed:
  - `Received error: invalid key: API key does not exist`
  - `backend error: invalid key: API key does not exist`
  - `failed to auth tailscale: tailscale up failed: exit status 1`

## Affected

| Resource | Namespace | Node(s) | Impact |
|----------|-----------|---------|--------|
| `tailscale-subnet-router` DaemonSet | `tailscale` | `k3s-node-1`, `k3s-node-2` | Subnet router pods crashlooped |
| `tailscale-doppler` managed Secret | `tailscale` | cluster-wide | Contained invalid `TS_AUTHKEY` |

## Root Cause

The `TS_AUTHKEY` value synced from Doppler was no longer valid in Tailscale. The DopplerSecret itself was healthy and continuously syncing, but it was syncing a rejected auth key.

This was not a node runtime, `/dev/net/tun`, DNS, or connectivity issue:

- Containers started successfully.
- `/dev/net/tun` was mounted.
- Tailscale reached `controlplane.tailscale.com`.
- DopplerSecret status was `SecretSyncReady=True`.
- The failure happened at Tailscale control-plane registration.

## Fix Steps

| Step | Action |
|------|--------|
| 1 | Checked pod state and logs for both DaemonSet pods. |
| 2 | Confirmed the common error was `invalid key: API key does not exist`. |
| 3 | Confirmed DopplerSecret `tailscale-doppler` was syncing successfully. |
| 4 | Updated `TS_AUTHKEY` in Doppler `rke2-cluster/main`. |
| 5 | Waited for Doppler sync and pod restart. |
| 6 | Verified both Tailscale pods recovered to `1/1 Running`. |

## Prevention

- [ ] Use a reusable, pre-approved auth key for the subnet-router DaemonSet, because pod state is `emptyDir` and restarts require re-authentication.
- [ ] Track Tailscale auth key expiry/revocation outside the cluster.
- [ ] Consider using a more durable state volume per node, or Tailscale Kubernetes operator/OAuth flow, to reduce dependency on reusable auth keys.
- [ ] Add an alert on `tailscale-subnet-router` CrashLoopBackOff with log hint `invalid key`.
