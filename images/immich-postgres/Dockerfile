# syntax=docker/dockerfile:1
# CloudNativePG PostgreSQL 17.10 standard image for Debian trixie, pinned 2026-08-03.
FROM ghcr.io/cloudnative-pg/postgresql:17.10-202608030910-standard-trixie@sha256:3659f88641c0a4f79d5c9385f3624306ed0c593d202dcc260e67c6f32f157751

ARG TARGETARCH
ARG PGVECTOR_VERSION=0.8.1
ARG VCHORD_VERSION=0.4.3

USER root

COPY checksums.sha256 /tmp/checksums.sha256

# This image is deliberately amd64-only: the homelab's three nodes are amd64 and
# the pinned VectorChord release archive is x86_64-specific.
RUN test "${TARGETARCH}" = "amd64"

# The CNPG standard image contains a newer PGDG pgvector package. Remove it so
# the source-built 0.8.1 files are the only owner of the vector extension paths.
RUN apt-get update \
 && apt-get remove -y postgresql-17-pgvector \
 && apt-get install -y --no-install-recommends \
      build-essential \
      ca-certificates \
      curl \
      postgresql-server-dev-17 \
      unzip \
 && rm -rf /var/lib/apt/lists/*

RUN set -eux; \
    curl --fail --show-error --location --retry 5 --retry-all-errors --retry-delay 2 --connect-timeout 30 --max-time 300 -o /tmp/pgvector-v${PGVECTOR_VERSION}.tar.gz \
      https://github.com/pgvector/pgvector/archive/refs/tags/v${PGVECTOR_VERSION}.tar.gz; \
    curl --fail --show-error --location --retry 5 --retry-all-errors --retry-delay 2 --connect-timeout 30 --max-time 300 -o /tmp/postgresql-17-vchord_${VCHORD_VERSION}_x86_64-linux-gnu.zip \
      https://github.com/supervc-stack/VectorChord/releases/download/${VCHORD_VERSION}/postgresql-17-vchord_${VCHORD_VERSION}_x86_64-linux-gnu.zip; \
    cd /tmp; \
    sha256sum -c /tmp/checksums.sha256; \
    mkdir /tmp/pgvector; \
    tar -xzf pgvector-v${PGVECTOR_VERSION}.tar.gz -C /tmp/pgvector --strip-components=1; \
    make -C /tmp/pgvector PG_CONFIG=/usr/lib/postgresql/17/bin/pg_config OPTFLAGS=""; \
    make -C /tmp/pgvector PG_CONFIG=/usr/lib/postgresql/17/bin/pg_config install; \
    unzip -q postgresql-17-vchord_${VCHORD_VERSION}_x86_64-linux-gnu.zip -d /tmp/vchord; \
    cp -r /tmp/vchord/pkglibdir/. "$(pg_config --pkglibdir)/"; \
    cp -r /tmp/vchord/sharedir/. "$(pg_config --sharedir)/"; \
    grep -q "default_version = '${PGVECTOR_VERSION}'" /usr/share/postgresql/17/extension/vector.control; \
    grep -q "default_version = '${VCHORD_VERSION}'" /usr/share/postgresql/17/extension/vchord.control; \
    rm -rf /tmp/pgvector /tmp/vchord /tmp/pgvector-v${PGVECTOR_VERSION}.tar.gz /tmp/postgresql-17-vchord_${VCHORD_VERSION}_x86_64-linux-gnu.zip /tmp/checksums.sha256

RUN apt-get purge -y --auto-remove \
      build-essential \
      curl \
      postgresql-server-dev-17 \
      unzip \
 && rm -rf /var/lib/apt/lists/* /var/cache/* /var/log/*

USER 26
