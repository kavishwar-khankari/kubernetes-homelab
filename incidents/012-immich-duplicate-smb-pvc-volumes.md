# Incident 012: Immich stuck ContainerCreating with duplicate SMB PVC volumes

**Date:** 2026-08-06  
**Detected:** 2026-08-05 19:25 UTC  
**Resolved:** 2026-08-05 19:52 UTC  
**Severity:** High (native cutover unavailable; brief single-writer safety violation)  

## Symptoms

- The native Immich server Pod remained `ContainerCreating` with no Pod IP.
- `PodReadyToStartContainers` stayed `False` and containerd had no sandbox or container for the Pod.
- Kubernetes emitted only the `Scheduled` event; no image pull or mount failure appeared.
- SMB CSI successfully staged and published the share, which initially obscured the volume-layout problem.
- `k3s-node-1` had 92% CPU requests allocated, but node pressure conditions were healthy.

## Affected

- Immich native application cutover in the `immich` namespace.
- Public `immich.techtronics.top` had no ready native backend during diagnosis.
- Compose Immich, ML, and Valkey were found still running after the native server became ready, despite an earlier intended stop command. They were stopped immediately. Both servers used the same PG17 database and media paths, so this did not create divergent datasets, but it violated the single-writer rule.

## Root Cause

The Helm values declared the same `immich-library` SMB PVC as five separate persistence entries: one managed-media volume and four external-library volumes. Each entry used a different `subPath`.

On `k3s-node-1`, kubelet stalled before CRI sandbox creation when the same SMB claim appeared as five Pod volumes. Controlled tests isolated the behavior:

- A Pod without SMB started on `k3s-node-1`.
- A Pod with the SMB PVC mounted once started.
- A Pod with one SMB PVC volume and five `subPath` mounts started.
- A Pod with five volume declarations referencing the same SMB PVC reproduced the indefinite `ContainerCreating` state.

The CPU-request saturation was a scheduling-capacity concern but not the cause of this incident.

## Fix Steps

1. Consolidated all managed and external-library mounts under the chart's single `server.persistence.data` entry.
2. Retained one `immich-library` PVC volume with five `globalMounts` and their existing `subPath` values.
3. Verified the rendered Deployment contains one PVC-backed volume and five container mounts.
4. Synced the fix through ArgoCD and confirmed the replacement Immich Pod became ready.
5. Verified all five paths inside the container, public API version `v3.0.3`, CNPG connectivity, and ML health.
6. Deleted all disposable diagnostic Pods.
7. Explicitly verified and stopped the remaining Compose Immich, ML, and Valkey containers.

## Prevention

- Represent one PVC as one Pod volume; use multiple `volumeMounts`/`subPath` entries for multiple paths from that claim.
- Inspect rendered Helm output for duplicate `claimName` references before storage-backed cutovers.
- Validate the exact final multi-mount Pod shape before switching public ingress, not only a root-volume mount.
- Verify Compose state with `docker compose ps` after every stop command before scaling the replacement writer above zero.
- Verify CNPG client addresses after cutover; unexpected node-network sessions indicate an old external writer may still be connected.
