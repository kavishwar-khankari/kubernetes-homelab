# Immich PostgreSQL Operand Image

This directory defines the CloudNativePG-compatible PostgreSQL 17 operand for Immich. It pins:

- CloudNativePG PostgreSQL `17.10-202608030910-standard-trixie` by digest.
- pgvector `0.8.1` from upstream tag `v0.8.1`.
- VectorChord `0.4.3` from its upstream amd64 prebuilt archive.

The image is intentionally `linux/amd64` only. Every current cluster node is amd64.

The CNPG standard base contains a newer pgvector package. The Dockerfile removes that package before installing the pinned `0.8.1` source build, so no package manager owns conflicting extension files.

## Published Image

```text
ghcr.io/kavishwar-khankari/immich-postgres@sha256:965e22f5123254e2d5635d1b719392c61c48398a50f91370d17529ffedd37709
```

The manifest list contains the tested `linux/amd64` image and its BuildKit provenance attestation. The tag `17.10-pgvector0.8.1-vchord0.4.3` is retained for humans, but deployment manifests must use the digest above.

## Build And Publish

Do this only from a controlled amd64 builder after authenticating to GHCR with a GitHub token that has `write:packages` permission. Do not put that token in this repository.

```bash
cd images/immich-postgres

export IMAGE=ghcr.io/kavishwar-khankari/immich-postgres
export TAG=17.10-pgvector0.8.1-vchord0.4.3

docker buildx build \
  --platform linux/amd64 \
  --load \
  --tag "${IMAGE}:${TAG}" \
  .
```

Run the validation below before publishing. When it passes, publish exactly the tested image:

```bash
docker login ghcr.io
docker push "${IMAGE}:${TAG}"
docker buildx imagetools inspect "${IMAGE}:${TAG}"
```

Record the resulting manifest-list digest in the CNPG values file. Production must reference `${IMAGE}@sha256:<digest>`, never the tag alone.

Make the GHCR package public before any cluster pull. A public package avoids an image pull Secret and keeps database restore independent from registry credentials.

## Validation

Run this from the same directory after the image build and before the push. It creates a disposable cluster inside the container and removes it when done.

```bash
export IMAGE=ghcr.io/kavishwar-khankari/immich-postgres
export TAG=17.10-pgvector0.8.1-vchord0.4.3

docker run --rm \
  --entrypoint /bin/sh \
  "${IMAGE}:${TAG}" \
  -ec '
    postgres --version
    test "$(id -u)" = 26
    test -f "$(pg_config --pkglibdir)/vchord.so"
    test -f "$(pg_config --sharedir)/extension/vector.control"
    test -f "$(pg_config --sharedir)/extension/vchord.control"
    initdb -D /tmp/pgdata
    printf "shared_preload_libraries = '\''vchord'\''\\n" >> /tmp/pgdata/postgresql.conf
    pg_ctl -D /tmp/pgdata -o "-k /tmp -p 55432" -w start
    psql -h /tmp -p 55432 -d postgres -v ON_ERROR_STOP=1 <<-SQL
      CREATE EXTENSION vector;
      CREATE EXTENSION vchord CASCADE;
      SELECT extname, extversion FROM pg_extension WHERE extname IN ('\''vector'\'', '\''vchord'\'') ORDER BY extname;
      CREATE TABLE vector_smoke_test (id bigint PRIMARY KEY, embedding vector(3));
      INSERT INTO vector_smoke_test VALUES (1, '\''[1,2,3]'\''), (2, '\''[2,3,4]'\'');
      CREATE INDEX vector_smoke_test_vchord_idx ON vector_smoke_test USING vchordrq (embedding vector_l2_ops);
      SELECT id FROM vector_smoke_test ORDER BY embedding <-> '\''[1,2,3]'\'' LIMIT 1;
    SQL
    pg_ctl -D /tmp/pgdata -m fast -w stop
  '
```

Expected extension output:

```text
 extname | extversion
---------+------------
 vchord  | 0.4.3
 vector  | 0.8.1
```

The CNPG `Cluster` must set `shared_preload_libraries` to `vchord` before creating the extension. The cluster chart will add that setting in a later checkpoint.

## Provenance

- CNPG base digest: official `catalog-standard-trixie.yaml`, 2026-08-03 build.
- pgvector tag: `v0.8.1`, commit `778dacf20c07caf904557a88705142631818d8cb`.
- pgvector archive checksum: calculated from the exact GitHub tag archive URL during the controlled build design. Upstream does not publish checksums or signed tags. The Nix source-tree hash for this release is not the raw archive checksum and must not be substituted here.
- VectorChord archive checksum: published by GitHub for the upstream `0.4.3` release asset.
- The published manifest list includes the BuildKit provenance attestation emitted by the builder. The pinned source digests, source checksums, final image digest, and Git commit remain the primary recorded provenance for this one-time image.
