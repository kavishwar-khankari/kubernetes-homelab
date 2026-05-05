# AGENTS.md

Read `CLAUDE.md` — it has all conventions and patterns.

## Watch for

- Domain: `*.techtronics.top`
- Ingress: omit `tls.secretName` (nginx-ingress uses default wildcard cert)
- RWO volumes + Deployment: `strategy: Recreate` (RollingUpdate deadlocks)
- Multi-container pods: co-locate tightly-coupled containers (shared networking)
- DopplerSecret: lives in `doppler-operator-system` namespace; `managedSecret` goes to target namespace
- Storage: Longhorn PVC (RWO), SMB CSI static PV+PVC (RWX), hostPath (with `mountPropagation: HostToContainer`), StatefulSet `volumeClaimTemplates`

## Two deployment patterns

**In-cluster**: `manifests/<app>/` + `argo-apps/<app>.yaml` (ref: jellyfin)
**Reverse-proxy**: `reverse-proxy/<app>/` — auto-discovered, no per-app ArgoCD yaml needed

## Bootstrap

`argo-master-app/master-app.yaml` → syncs `argo-apps/` → syncs everything. Push to deploy.
