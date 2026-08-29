# Pangolin — VPS deployment (gateway IP only)

Self-hosted Pangolin (Enterprise) control plane for `ampere-vm` (tailnet: `NPLVM`).
Bound exclusively to the gateway IP `10.0.0.150` (public `161.118.165.106`).
The primary IP (`10.0.0.149` / public `144.24.126.155`) keeps the family VPN,
nginx DoH, and all existing Docker services.

Full plan and decision log: Obsidian → `AI notes/Homelab Public Gateway/PANGOLIN-MIGRATION-PLAN.md`

## Layout

```
vps/pangolin/
├── docker-compose.yml        # pangolin EE + gerbil + traefik (pinned versions)
└── config/
    ├── config.yml            # dashboard domain, DNS-01 wildcard, flags
    └── traefik/
        ├── traefik_config.yml    # static: DNS-01 resolver, 60m readTimeout
        └── dynamic_config.yml    # dashboard routers + global security headers
```

Runtime state (`db/`, `key`, `letsencrypt/`, `traefik/logs/`) is generated on the
VPS and gitignored.

## Secrets (never in git)

`/root/pangolin/secrets.env` (0600, root) — required on the VPS:

```
CLOUDFLARE_DNS_API_TOKEN=<Cloudflare API token, Zone:Read + DNS:Edit on techtronics.top>
SERVER_SECRET=<openssl rand -hex 32>
```

`SERVER_SECRET` env var is required by the `pangolin` container;
`CLOUDFLARE_DNS_API_TOKEN` by `traefik` for Let's Encrypt DNS-01.

## Deploy (Phase 2 of the Obsidian plan — only after the gateway is stopped)

1. Rebind the VPS nginx off the wildcard 80/443 first:
   change `listen 80 default_server;` → `listen 10.0.0.149:80 default_server;`
   and `listen 443 ssl http2;` → `listen 10.0.0.149:443 ssl http2;`
   (keep the `[::]` lines) in `/etc/nginx/sites-enabled/{default,dns.techtronics.top.conf}`,
   then `nginx -t && systemctl reload nginx`. Verify DoH still works:
   `curl -sk https://dns.techtronics.top/dns-query?dns=example.com --resolve dns.techtronics.top:443:144.24.126.155`
2. Re-run the VPS firewall script (`vps/firewall/homelab-iptables.sh`) — it now
   opens UDP 51820 in HOMELAB-INPUT and forwards WAN→Docker for the Pangolin
   ports (TCP 80/443, UDP 51820). Without this the published ports are
   silently dropped by HOMELAB-FORWARD. Re-run it after any Docker restart too.
3. Copy these files to the VPS (`/opt/pangolin/`) and start:
   `docker compose up -d`
4. First-run: `docker compose logs pangolin | grep -i token` → open
   `https://pangolin.techtronics.top/auth/initial-setup` → admin email + strong
   password → create org → enable TOTP (profile menu) → Server Admin →
   `/admin/license` → paste the EE key from Doppler (`PANGOLIN_EE_LICENSE_KEY`).

## Upgrades

- Backup the whole `config/` dir first (`docs.pangolin.net/self-host/how-to-update`).
- `docker compose pull`, bump the badger plugin version in `traefik_config.yml`, restart.
- Incremental major-version upgrades only; downgrades unsupported.
- `pangctl` ops (inside the container): `pangctl clear-certificates`,
  `pangctl rotate-server-secret --old-secret ... --new-secret ...` (needs a restart after).

## Blueprints

Public resources are declared in `blueprint.yaml` (resource keys = Pangolin
Identifiers/niceIds; targets reference sites by their Identifier — keep the
three site Identifiers as `k3s-node-1/2/3` in the dashboard). Apply via
dashboard → Settings → Blueprints → paste, or with the standalone Pangolin CLI
on the VPS after authenticating it:
`pangolin apply blueprint --file /opt/pangolin/config/blueprint.yaml`
The running Pangolin container does not include the `pangolin` CLI; `pangctl`
inside the container is an unrelated administrative tool.
No secrets ever in blueprints; public resources carry no auth block plus a
catch-all `allow` rule (allow = bypass auth).

For a change to one resource, apply a blueprint containing only that resource
(for example, `s3-only.yaml`) rather than submitting the full file. This keeps
unrelated public resources out of the change. The authenticated-session CLI
command above uses the selected account and organization. Automation without a
session must provide all three integration flags: `--api-key`, `--endpoint`,
and `--org`.

## Notes

- 21820/udp is intentionally not published (no Pangolin client apps).- HTTP/3 QUIC is off (no 443/udp published).
- `flags.allow_raw_resources: false` — raw TCP/UDP resources disabled.
- Telemetry disabled; invite-only signup; no SMTP.
- Let's Encrypt contact email in `traefik_config.yml` is a placeholder — change it
  if expiry notices are wanted.
- ACME propagation checks run against `1.1.1.1`/`8.8.8.8` (`dnsChallenge.resolvers`)
  because the VPS's Oracle DNS negatively caches `_acme-challenge` NXDOMAINs and
  otherwise breaks every issuance.
