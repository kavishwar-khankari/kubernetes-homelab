# Garage for Silo: Portainer Setup

This is the external TrueNAS/Portainer step for the Silo trial. It is not a
Kubernetes manifest and must not be added to an Argo application.

## Preconditions

- TrueNAS Community `25.04.1` (`truenas`).
- Portainer manages Docker.
- Existing Jellyfin share: `//192.168.0.75/media_2/media`.
- Existing Jellyfin share path: `/mnt/TANK_2/media_2/media`.
- Garage root: `/mnt/TANK_2/media_2/garage`.

The Garage root must be a sibling of the exported `media` path. Never use
`/mnt/TANK_2/media_2/media/garage`; that directory would be visible to every
Kubernetes workload mounting the media share.

Create the following directories through the TrueNAS UI or dataset tools. The
`truenas_admin` shell account currently cannot traverse the media path, so do
not use an unreviewed recursive `chmod` as a workaround.

```text
/mnt/TANK_2/media_2/garage/
├── meta/
└── data/
```

Prefer a dedicated child dataset at `TANK_2/media_2/garage`. Do not export it
over SMB or NFS. Grant the Docker daemon/container identity access to both
directories and verify that the media-share identity cannot read or write them.

## Garage Configuration

Create a host file at:

```text
/mnt/TANK_2/media_2/garage/garage.toml
```

Replace every placeholder locally. Do not commit the completed file, paste it
into chat, or store it in the repository. Set the file mode to `600` so the
RPC and admin credentials are not world-readable.

```toml
metadata_dir = "/var/lib/garage/meta"
data_dir = "/var/lib/garage/data"
db_engine = "sqlite"
replication_factor = 1

rpc_bind_addr = "[::]:3901"
rpc_public_addr = "127.0.0.1:3901"
rpc_secret = "<64_HEX_CHARACTER_RPC_SECRET>"

[s3_api]
api_bind_addr = "[::]:3900"
s3_region = "garage"

[admin]
api_bind_addr = "0.0.0.0:3903"
admin_token = "<ADMIN_TOKEN>"
metrics_token = "<METRICS_TOKEN>"
metrics_require_token = true
```

The single-node topology is intentional for this trial. `replication_factor =
1` provides no Garage-level redundancy; TrueNAS snapshots/replication are the
external durability layer.

## Portainer Stack

Create or update one Portainer Stack named `garage` with this Compose
definition. It runs Garage and the browser-based Garage UI together on a
private Docker network. The amd64 digests were verified on 2026-08-29.

Before deploying, add these two Portainer stack environment variables. Do not
commit their values or paste them into chat:

```text
GARAGE_ADMIN_TOKEN=<the admin_token from garage.toml>
GARAGE_UI_PASSWORD=<a separate strong UI password>
```

```yaml
networks:
  garage-internal:
    driver: bridge

services:
  garage:
    image: dxflrs/garage@sha256:dac0c92add4f1a0b41035e94b41036a270ffbe88a37c7ac9c3f19e6dc5bdccf2  # v2.3.0
    container_name: garage
    restart: unless-stopped
    ports:
      - "3900:3900"
    volumes:
      - /mnt/TANK_2/media_2/garage/meta:/var/lib/garage/meta
      - /mnt/TANK_2/media_2/garage/data:/var/lib/garage/data
      - /mnt/TANK_2/media_2/garage/garage.toml:/etc/garage.toml:ro
    command: ["/garage", "server", "--single-node"]
    networks:
      garage-internal:
        aliases:
          - garage
    healthcheck:
      test: ["CMD", "/garage", "status"]
      interval: 30s
      timeout: 10s
      retries: 5

  garage-ui:
    image: docker.io/noooste/garage-ui:v0.12.1@sha256:f14116e773c71e191ddfb5cbb7eb7206265b208fabdec39cc47ce42658f7b326
    container_name: garage-ui
    restart: unless-stopped
    depends_on:
      garage:
        condition: service_healthy
    ports:
      - "192.168.0.75:8080:8080"
    networks:
      - garage-internal
    environment:
      GARAGE_UI_SERVER_HOST: "0.0.0.0"
      GARAGE_UI_SERVER_PORT: "8080"
      GARAGE_UI_GARAGE_ENDPOINT: "http://garage:3900"
      GARAGE_UI_GARAGE_ADMIN_ENDPOINT: "http://garage:3903"
      GARAGE_UI_GARAGE_REGION: "garage"
      GARAGE_UI_GARAGE_FORCE_PATH_STYLE: "true"
      GARAGE_UI_GARAGE_ADMIN_TOKEN: "${GARAGE_ADMIN_TOKEN}"
      GARAGE_UI_AUTH_ADMIN_ENABLED: "true"
      GARAGE_UI_AUTH_ADMIN_USERNAME: "garage-admin"
      GARAGE_UI_AUTH_ADMIN_PASSWORD: "${GARAGE_UI_PASSWORD}"
      GARAGE_UI_AUTH_TOKEN_ENABLED: "false"
```

The `garage-internal` network is the only path from Garage UI to the Admin API.
Garage's Admin API binds to the container's private network interface, but
`3903` has no host mapping and is not reachable from the LAN or WAN. Do not
add host mappings for RPC `3901`, website `3902`, or admin/metrics `3903`.

Open the UI at:

```text
http://192.168.0.75:8080
```

Use the `garage-admin` UI account. In the UI, create `silo-assets` and
`silo-private`, create the `silo` key, grant it `Read` and `Write` on both
buckets. Garage UI v0.12.1 does not expose bucket CORS configuration; apply
CORS through the S3 API in the next section. The UI is the preferred
management path for buckets and keys; the Garage image has no shell, so do not
select `/bin/sh` in Portainer's Garage console.

After starting the stack, inspect the container logs and status:

```bash
docker exec garage /garage status
```

The node must be healthy and have a role/layout assigned. If the pinned image
does not complete the single-node bootstrap, follow the version-matched
`garage layout assign` and `garage layout apply` procedure from the official
Garage documentation before creating buckets.

## Buckets and Key

Run these commands through the Portainer console or an approved TrueNAS shell.
The final command prints the S3 secret; capture it directly into Doppler and do
not include it in logs or chat.

```bash
docker exec garage /garage bucket create silo-assets
docker exec garage /garage bucket create silo-private
docker exec garage /garage key create silo
docker exec garage /garage bucket allow --read --write silo-assets --key silo
docker exec garage /garage bucket allow --read --write silo-private --key silo
docker exec garage /garage key info silo
```

Add the resulting access key and secret to Doppler as:

```text
GARAGE_SILO_ACCESS_KEY
GARAGE_SILO_SECRET_KEY
```

Create separate buckets and keys for future applications. Never use the Garage
admin token as an S3 application credential.

The Silo key is intentionally `Read`/`Write` only. Garage rejects
`PutBucketCors` for that permission level. Temporarily grant `Owner` to the
key on both buckets through Garage UI, apply the CORS configuration below, and
then remove `Owner` while leaving `Read` and `Write` enabled. Do not leave the
application key with bucket-management permissions.

## CORS

Create a temporary local `silo-cors.json` file, apply it to both buckets, and
delete it after verification:

```json
{
  "CORSRules": [
    {
      "AllowedOrigins": [
        "https://silo.techtronics.top",
        "https://silo-jf.techtronics.top"
      ],
      "AllowedMethods": ["GET", "PUT", "POST", "DELETE", "HEAD"],
      "AllowedHeaders": ["*"],
      "ExposeHeaders": ["ETag", "Content-Length"],
      "MaxAgeSeconds": 3000
    }
  ]
}
```

Apply with the scoped Silo key, not the admin token:

```bash
aws --endpoint-url http://192.168.0.75:3900 --region garage \
  s3api put-bucket-cors --bucket silo-assets \
  --cors-configuration file://silo-cors.json
aws --endpoint-url http://192.168.0.75:3900 --region garage \
  s3api put-bucket-cors --bucket silo-private \
  --cors-configuration file://silo-cors.json
```

## Validation Gate

Before enabling Silo's Argo sync, verify all of the following:

- `PutObject`, `GetObject`, `HeadObject`, `ListObjectsV2`, and Delete work.
- Multipart upload works.
- A presigned download works from outside the cluster.
- Browser CORS requests work from both Silo hostnames.
- Anonymous access to a private object is rejected.
- `aws s3 ls --endpoint-url https://s3.techtronics.top --region garage` works externally.
- The public route preserves the `Host` header and presigned query string.
- Garage admin/metrics port `3903` is not reachable from the public route.
- TrueNAS snapshots are configured for the Garage root/dataset.

Pangolin routing is documented in the Silo implementation plan. Do not apply
the `s3` blueprint entry until the local Garage checks pass.

## Silo Seed Configuration

The Kubernetes deployment mounts a generated `/seed/silo.yaml` and sets the
Silo container working directory to `/seed`. Silo imports this file once, then
stores the settings in PostgreSQL and marks the import complete. Editing the
Git-managed manifest later will not update an already-initialized database;
use Silo's settings API or deliberately clear the database import marker.

## Sources

- https://garagehq.deuxfleurs.fr/documentation/quick-start/
- https://garagehq.deuxfleurs.fr/documentation/reference-manual/configuration/
- https://garagehq.deuxfleurs.fr/documentation/reference-manual/s3-compatibility/
- https://garagehq.deuxfleurs.fr/documentation/cookbook/real-world/
- https://github.com/Noooste/garage-ui
- https://docs.portainer.io/user/docker/containers/console
