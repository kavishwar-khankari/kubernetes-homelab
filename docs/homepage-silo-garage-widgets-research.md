# Homepage Silo and Garage Integration Research

Date: 2026-08-30

## Findings

Homepage has no native service widget for Silo, Garage, Garage UI, or a
generic S3-compatible object store. The official service widget catalog and
Homepage source contain no `silo`, `garage`, `garage-ui`, or `s3` widget type.

Sources:

- https://gethomepage.dev/widgets/services/
- https://gethomepage.dev/configs/services/
- https://github.com/gethomepage/homepage

Silo exposes a health endpoint at `/api/v1/health`, but its authenticated
administrative APIs are not suitable for a Homepage widget. The Silo public
Pangolin route is currently disabled, so the Homepage link is pre-wired to the
public hostname while its status monitor uses the in-cluster Service.

Sources:

- https://github.com/Silo-Server/silo-server
- https://siloserver.org/docs/jellyfin-compatibility/
- `manifests/silo/service.yaml`
- `vps/pangolin/blueprint.yaml`

Garage's S3 endpoint requires SigV4 authentication and has no Homepage-native
widget. Its admin API requires a bearer token and is intentionally private to
the Garage UI network, so it must not be polled directly from Homepage. The
Garage UI is a browser application rather than a documented JSON status API.

Sources:

- https://garagehq.deuxfleurs.fr/documentation/reference-manual/admin-api/
- https://garagehq.deuxfleurs.fr/documentation/reference-manual/s3-compatibility/
- https://github.com/Noooste/garage-ui
- `docs/garage-silo-portainer.md`

The dashboard-icons repository provides `garage.png`, but no Silo or Garage UI
icon. Silo therefore uses the built-in `mdi-movie-open` icon. No credentials
are needed for either service card.

Source:

- https://github.com/homarr-labs/dashboard-icons
- https://gethomepage.dev/configs/services/#icons

## Implemented Configuration

`manifests/homepage/configmap.yaml` now contains plain service cards for Silo
and Garage UI. Silo is under `Media`; Garage UI is under `Cloud`. Both use
`siteMonitor`, and neither uses `customapi` because there is no stable,
credential-safe JSON endpoint available.

`manifests/homepage/deployment.yaml` has a changed config checksum annotation.
Homepage mounts the ConfigMap with `subPath`, so this is required to roll the
pod and load the new configuration.
