# Incident 013: WireGuard gateway fwmark collided with Cilium identity marks

**Date:** 2026-08-08
**Detected:** 2026-08-07
**Resolved:** 2026-08-08
**Severity:** High (node-1 pod egress and ArgoCD reconciliation were affected)

## Symptoms

- ArgoCD could fetch revision `c2056b8` but failed while applying the gateway ConfigMap with `dial tcp 10.43.0.1:443: i/o timeout`.
- Tachidesk reported `Network is unreachable` and `NoRouteToHost` for external sources.
- SearXNG search engines timed out.
- Cilium reported `HostAdminProhibited` from `10.77.77.1` to the Tachidesk pod.

## Affected

| Component | Namespace | Impact |
|-----------|-----------|--------|
| ArgoCD application controller | default | Could not reliably reach the Kubernetes API Service from node 1 |
| Tachidesk | tachidesk | External source requests were routed into WireGuard |
| SearXNG | searxng | Search-engine requests failed from the node-1 pod |
| Public gateway replies | wg-gateway | Required the marked reply route to remain functional |

## Root Cause

The gateway used `0x10000` as its policy-routing mark and matched it with `fwmark 0x10000/0x10000` at priority 8. Cilium uses bits 16-31 for endpoint identity. A live Tachidesk SYN entered node 1 with Cilium mark `0x99850f00`, which includes bit `0x10000`, so the gateway interpreted ordinary Cilium traffic as gateway reply traffic and routed it through table 100 and WireGuard.

The earlier broad `CONNMARK --restore-mark` rule amplified the problem, but narrowing that rule alone did not remove the mark collision.

## Fix Steps

| Step | Action |
|------|--------|
| 1 | Captured the live nftables path and confirmed the Cilium mark and WireGuard egress interface. |
| 2 | Committed `d12b7d0`, changing the gateway mark to Cilium-safe `0x0600/0x0f00`. |
| 3 | Changed CONNMARK operations to masked `--set-xmark`/restore operations so Cilium identity bits remain intact. |
| 4 | Restricted reply restoration with `--ctdir REPLY` and added migration cleanup for the old `0x10000` rules. |
| 5 | Bumped the DaemonSet revision to `8`; applied the exact committed manifests once because the old route blocked ArgoCD's API operation. |
| 6 | Verified ArgoCD `Synced/Healthy`, all three gateway pods Ready, Tachidesk GitHub `HTTP 200`, SearXNG engine endpoint connectivity, and public gateway responses. |

## Prevention

- [x] Do not use Cilium identity bits 16-31 for custom policy marks.
- [x] Use an explicit mark mask and preserve unrelated packet/conntrack mark bits.
- [x] Restore gateway marks only in the conntrack reply direction.
- [x] Test a normal pod SYN and a public gateway reply separately after routing changes.
- [ ] Add an automated node-level mark-collision regression check.
