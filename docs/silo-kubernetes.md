# Silo Kubernetes Deployment

This is the Kubernetes translation of Silo's official service topology. The
upstream project documents Docker Compose rather than a Kubernetes chart or
manifest set:

- <https://siloserver.org/docs/installation/>
- <https://github.com/Silo-Server/silo-server>

## Topology

- `silo`: one GPU-scheduled integrated-mode Deployment containing Silo, PostgreSQL 18 + pgvector, and Redis.
- PostgreSQL and Redis are bound only to the pod's loopback interface.
- Meilisearch is a bounded sidecar sharing the existing `silo-data` claim; it has no Service or third PVC.
- Jellyfin and Audiobookshelf compatibility listeners remain disabled.

The existing `silo-data` claim is retained for Silo state and the existing
`silo-cache` claim is retained for transcode/download scratch data. The old
claim must not be deleted or reformatted until the first production boot and
data review are complete.

This intentionally caps Silo at two Longhorn PVCs. PostgreSQL, Redis, and
Silo share the `silo-data` claim through separate directories, so they restart
together on the GPU node. This is the storage-efficient tradeoff; separate
StatefulSets would require additional RWO claims.

Meilisearch is capped at a 1Gi container limit, a 256MiB indexing-memory budget,
and one indexing thread. Its index lives in `/data/meilisearch` alongside the
other Silo state, so monitor its resident memory and disk growth during catalog
rebuilds. The indexing-memory setting does not cap all Meilisearch memory use.

The generated `/seed/silo.yaml` is a bootstrap import. Silo persists imported
settings in PostgreSQL and ignores the file on later boots, so subsequent S3,
scanner, playback, or compatibility changes must be made through Silo's
admin-managed settings/API rather than by editing this file alone.

## Doppler Gate

Before syncing the Argo application, the managed `silo/silo-secrets` Secret
must contain these generated keys:

- `SECRET_KEY`, sourced from `SILO_SECRET_KEY`
- `POSTGRES_PASSWORD`, sourced from `SILO_POSTGRES_PASSWORD`
- `DATABASE_URL`, sourced from `SILO_DATABASE_URL`
- `MEILI_MASTER_KEY`, sourced from `SILO_MEILI_MASTER_KEY`
- `GARAGE_SILO_ACCESS_KEY`
- `GARAGE_SILO_SECRET_KEY`

`SILO_DATABASE_URL` must use the pod-local PostgreSQL listener:

```text
postgres://silo:<password>@127.0.0.1:5432/silo?sslmode=disable
```

Never place the actual values in Git, command history, or support output. The
key names can be checked safely with:

```bash
kubectl -n silo describe secret silo-secrets
```

Confirm every listed key is present before syncing. Never inspect or print the
values.

## Rollout Gate

1. Confirm all required Doppler keys exist and the two existing claims remain `Bound`.
2. Review the Argo diff for `default/silo`; do not use `kubectl apply` for the rollout.
3. Sync through the Argo application controller:

```bash
kubectl exec -n default statefulset/argo-cd-argocd-application-controller -- \
  argocd --core app sync silo --assumeYes --timeout 7800
```

4. Wait for all four containers to be ready before evaluating Silo readiness.
5. Verify `/api/v1/health`, `/api/v1/ready`, Garage object access, GPU allocation,
   media read-only behavior, restart persistence, and memory usage.
6. Keep `silo` and `silo-jf` disabled in the Pangolin blueprint until these checks pass.

## Meilisearch

Silo starts with PostgreSQL search until Meilisearch is configured through
Silo's Admin Settings. After the core deployment is healthy, configure the
search provider as Meilisearch with URL `http://127.0.0.1:7700`, the same
master key stored in Doppler, and semantic search disabled. Restart Silo after
saving because search-provider settings are restart-bound.

`POSTGRES_TUNE=off` is intentional because PostgreSQL has a 4Gi container
limit. Its loopback listener and memory settings are explicit in
`deployment.yaml`; this avoids Silo calculating tuning values from the GPU
node's `/proc/meminfo`. If the database budget changes, update those settings
with the limit rather than enabling automatic tuning blindly.

## Compatibility Web

Do not run `silo compat-web install` in the Silo Deployment's init path. The
upstream command is an explicit post-start compatibility operation and the
previous in-pod source build exhausted the GPU node's memory. If compatibility
is needed later, build or install it in a separately bounded maintenance
workflow, validate it, then enable the listeners deliberately.
