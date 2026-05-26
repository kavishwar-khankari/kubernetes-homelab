# Incident 002: Loki chunks cache memory overprovisioning

**Date:** 2026-05-27  
**Detected:** 2026-05-27 during live inspection of `monitoring-loki-chunks-cache-0`  
**Resolved:** 2026-05-27  
**Severity:** Medium (no outage, but one cache pod reserved 61% of a 16Gi node)

## Symptoms

- `monitoring-loki-chunks-cache-0` showed ~5.6Gi RSS in `kubectl top`
- memcached reported ~5.10Gi `current_bytes` out of an 8Gi ceiling
- The pod requested and limited itself to `9830Mi`
- `k3s-node-1` had the pod consuming most of the node's memory headroom
- No restarts, no evictions, no OOMs, and no node `MemoryPressure`

## Affected

| Pod | Namespace | Node | Evidence |
|-----|-----------|------|----------|
| `monitoring-loki-chunks-cache-0` | monitoring | `k3s-node-1` | memcached RSS ~5.6Gi, `current_bytes` ~5.10Gi, request/limit `9830Mi` |

## Root Cause

1. The Grafana Loki Helm chart defaults the chunks cache to `allocatedMemory: 8192` and `defaultValidity: 0s`.
2. `helm/monitoring-loki/values.yaml` did not override `chunksCache`, so the chart rendered the default 8Gi memcached cache.
3. This cache was behaving normally: ~96.9% hit rate, `0` evictions, and no OOM signals. The high RSS was mostly expected cache fill, not a leak.
4. The sizing was too large for a homelab node with only ~16Gi allocatable memory, so one cache pod consumed too much scheduling headroom.

## Fix Steps

| Step | Action |
|------|--------|
| 1 | Add `chunksCache.allocatedMemory: 2048`, `allocatedCPU: 100m`, and `defaultValidity: 6h` to `helm/monitoring-loki/values.yaml` |
| 2 | Rendered `helm template` to verify the memcached arg changed to `-m 2048` and the request/limit dropped to `2458Mi` |
| 3 | Committed and pushed the GitOps change (`3560b81`) |
| 4 | Let ArgoCD sync and roll the `monitoring-loki-chunks-cache` StatefulSet |
| 5 | Re-check `memcached_current_bytes`, evictions, and Loki query latency after warm-up |

## Prevention

- Size memcached caches explicitly instead of relying on chart defaults
- Treat `chunksCache.defaultValidity: 0s` as "no TTL" and budget memory accordingly
- Review node allocatable versus StatefulSet requests before placing large caches on 16Gi nodes
- Add alerts for sustained high cache occupancy or node request saturation
- Prefer 2Gi or 4Gi cache ceilings for homelab-scale Loki unless query load proves otherwise
