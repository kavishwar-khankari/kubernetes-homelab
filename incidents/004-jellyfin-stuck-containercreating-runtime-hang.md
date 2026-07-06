# Incident 004: Jellyfin stuck ContainerCreating after old pod deletion

**Date:** 2026-07-06
**Detected:** After deleting the old Jellyfin pod during a restart attempt
**Resolved:** 2026-07-06
**Severity:** High (Jellyfin unavailable)

## Symptoms

- New Jellyfin pod stuck in `ContainerCreating` on `k3s-node-3`.
- Pod had no IP and only showed the `Scheduled` event.
- Previous Jellyfin pods repeatedly failed to terminate:
  - `KillContainerError: rpc error: code = DeadlineExceeded`
  - `KillPodSandboxError: rpc error: code = DeadlineExceeded`
- Node still had old Jellyfin-related processes after Kubernetes thought pods were being replaced:
  - zombie `jellyfin` processes
  - an old `/usr/lib/jellyfin-ffmpeg/ffmpeg` process in `D` uninterruptible sleep

## Affected

| Resource | Namespace | Node | Impact |
|----------|-----------|------|--------|
| `jellyfin-844bd4fb4d-*` | `jellyfin` | `k3s-node-3` | New pod could not start |
| `jellyfin` Deployment | `jellyfin` | `k3s-node-3` | Service unavailable |

## Root Cause

The old Jellyfin container did not fully terminate. A Jellyfin ffmpeg transcode process remained stuck in kernel `D` state, so kubelet/containerd could not finish killing the old pod sandbox. The replacement pod was scheduled and its Longhorn volumes were published successfully, but it never advanced to pod sandbox/network creation.

Evidence that this was not a Longhorn attach/mount failure:

- Jellyfin PVCs were `Bound`.
- Longhorn volumes were `attached` and `healthy` on `k3s-node-3`.
- Longhorn CSI `NodePublishVolume` returned success for Jellyfin PVCs.
- Intel GPU plugin allocation succeeded for the replacement pod.

The remaining blocker was node-local runtime/process state on `k3s-node-3`.

## Fix Steps

| Step | Action |
|------|--------|
| 1 | Confirmed Jellyfin pod was stuck before sandbox/IP creation. |
| 2 | Checked Longhorn PVC, VolumeAttachment, and CSI logs to rule out volume mount failure. |
| 3 | Checked node process list and found old `jellyfin` zombies plus `ffmpeg` in `D` state. |
| 4 | Rebooted `k3s-node-3` to clear unkillable kernel/process state. |
| 5 | Verified `k3s-node-3` returned `Ready`. |
| 6 | Verified Jellyfin recovered as `3/3 Running`. |

## Prevention

- [ ] Add an operational runbook note: if a pod has no IP, CSI succeeded, and old container kill operations time out, check node-local `D` state processes before deleting more pods.
- [ ] Consider alerting on repeated `FailedKillPod` events for media workloads.
- [ ] Consider monitoring for long-running `jellyfin-ffmpeg` processes in `D` state on the GPU node.
- [ ] Keep Jellyfin on `strategy: Recreate` because it uses RWO Longhorn config storage.
- [ ] Continue avoiding manual Longhorn cleanup unless CSI/Longhorn events show real attach or mount failure.
