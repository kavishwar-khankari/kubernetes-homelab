# 015 — Pangolin total 404 after compose network recreate (badger plugin cache loss)

## Date
2026-08-13

## Symptoms
- Every public resource + the dashboard (`pangolin.techtronics.top`) returned
  `404 page not found` immediately after `docker compose up -d` recreated the
  Pangolin bridge network (change: `enable_ipv6: true` for the IPv6 rollout).
- Newt pods in the cluster crash-looped: `failed to get token ... 404` against
  the dashboard URL (their auth path), 4+ restarts each.
- Traefik log: `invalid middleware "badger@file"/"badger@http" configuration:
  invalid middleware type or middleware does not exist` for EVERY router.

## Affected
- All 13 public resources, the Pangolin dashboard, all 3 Newt pods (auth path
  via dashboard). ~30 min total outage window. IPv4 and IPv6 equally.

## Root Cause
Chain of two interacting issues:

1. **Network recreate changed the bridge ID.** The firewall script's
   DOCKER-FORWARD allowance enumerates bridge interfaces at script-run time.
   The new bridge (`br-c1ec7a4e6d3c`) wasn't in the rules → the Pangolin
   containers had **no outbound internet** (recurrence of the Phase 2 bug —
   this is the third time: bridge created after the firewall script run).
2. **Traefik's plugin cache was ephemeral.** The badger auth plugin is
   downloaded by Traefik at startup into `/plugins-storage`, which lived in
   the container's writable layer. The container recreation wiped it, and
   with no egress the re-download failed → badger middleware undefined →
   every router referencing it failed → all 404.

## Fix Steps
1. Re-ran `/tmp/homelab-iptables.sh` (dynamic bridge discovery) → egress
   restored; both iptables and ip6tables updated.
2. Added persistent volume `./config/plugins:/plugins-storage` to the
   traefik service in `vps/pangolin/docker-compose.yml` (committed `d7b44d8`).
3. `docker compose up -d` → Traefik downloaded badger into the persistent
   mount; all routers healthy.
4. Deleted the two crash-looping Newt pods (node-2 had already recovered);
   all 3 back to 1/1, targets loaded.

## Prevention
- Plugin cache is now persistent across recreations.
- Runbook note (also in the plan): **after any Docker network creation or
  recreation, re-run the firewall script.** A follow-up hardening: make the
  firewall script hook into docker network events or move DOCKER-FORWARD
  acceptance to a periodic/systemd-triggered reconcile.
