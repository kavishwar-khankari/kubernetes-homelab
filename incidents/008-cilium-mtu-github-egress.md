# Incident 008: Cilium MTU mismatch blocked GitHub HTTPS egress

**Date:** 2026-07-10
**Detected:** ArgoCD Applications changed from `Synced` to `Unknown` while fetching GitHub.
**Resolved:** 2026-07-10
**Severity:** High (ArgoCD could not reconcile any GitOps Application)

## Symptoms

- ArgoCD repo-server logged `context deadline exceeded` for GitHub `git-upload-pack` requests.
- Applications repeatedly changed between `Synced` and `Unknown`.
- Pods resolved `github.com` and completed the TCP handshake to port 443, but TLS stalled before the ServerHello.
- The same TLS connection succeeded from Cilium's host-networked pod.

## Affected

| Component | Namespace | Impact |
|-----------|-----------|--------|
| ArgoCD repo-server | default | Could not fetch the Git repository to render manifests |
| All ArgoCD Applications | default | Desired state became `Unknown`; automated sync stopped |
| Tdarr | tdarr | The pinned 2.82.02 upgrade could not reconcile |

## Root Cause

Cilium used VXLAN with automatic MTU detection. The `tailscale0` interface had an MTU of `1280`, so it became the lowest selected external interface. Cilium consequently configured its VXLAN datapath to `1280`, while workload veth interfaces remained at `1500` on a physical `1500`-byte LAN. The inconsistent pod egress path black-holed GitHub TLS traffic.

## Fix Steps

| Step | Action |
|------|--------|
| 1 | Verified DNS and TCP connectivity from normal pods, then confirmed that TLS succeeded only from the host network. |
| 2 | Confirmed Cilium VXLAN MTU was `1280`, matching `tailscale0`; physical interfaces were `1500`. |
| 3 | Committed `cd7c6f1`, adding an RKE2 `rke2-cilium` HelmChartConfig with `MTU: 1500`, `rollOutCiliumPods: true`, and `maxUnavailable: 1`. |
| 4 | Applied the exact committed HelmChartConfig once as a bootstrap exception because ArgoCD could not fetch GitHub. |
| 5 | RKE2 rolled Cilium one agent at a time; all three agents became ready. |
| 6 | Verified Cilium's persisted MTU was `1500`, GitHub `git ls-remote` worked from repo-server, and ArgoCD reconciled the pending Tdarr upgrade. |

## Prevention

- [x] Cilium MTU is pinned to the physical LAN MTU; VXLAN derives the effective `1450` route MTU.
- [x] Cilium rollout concurrency is limited to one unavailable agent.
- [x] The configuration is owned by ArgoCD in `argo-apps/cilium.yaml`.
- [x] The one-time bootstrap action used the exact committed desired-state manifest.
- [ ] Alert when ArgoCD Applications enter `Unknown` because repository rendering fails.
