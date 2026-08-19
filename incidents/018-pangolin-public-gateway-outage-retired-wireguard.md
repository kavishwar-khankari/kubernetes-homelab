# Incident 018: Pangolin public gateway outage after VPS reboot

## Date

2026-08-19

**Resolved:** 2026-08-19 for the public Pangolin path and Newt tunnels.

**Status:** Service restored. Legacy Kubernetes cleanup and restart-prevention changes are pending a deliberate decision.

## Symptoms

- After the Oracle VPS rebooted, Pangolin-hosted public services were unreachable.
- External clients received a network-level failure instead of an HTTP response.
- Newt pods repeatedly failed to obtain a token from `https://pangolin.techtronics.top` and entered `CrashLoopBackOff`.
- Pangolin reported all three Newt sites offline and public resource routers returned `503`.
- After the old NAT rule was removed and Gerbil was manually restarted, the symptom changed to `connection refused` on Pangolin gateway ports.

## Affected

- VPS `ampere-vm` public Pangolin gateway at `10.0.0.150`, public IPv4 `161.118.165.106`, and its public IPv6.
- All three Kubernetes Newt sites and the public services routed through them.
- The family VPN `wg0` on UDP `61115` was not affected.
- The primary service address `10.0.0.149`, AdGuard, and its local web/DNS bindings were not the failing path.

## Root Cause

### Primary outage: retired WireGuard service reactivated on boot

Pangolin had replaced the old `wg-jellyfin` public relay, but the VPS systemd unit `wg-quick@wg-jellyfin.service` remained enabled. During boot it recreated the old interface and inserted this rule at the front of IPv4 `PREROUTING`:

```text
10.0.0.150:80/443 -> DNAT 10.77.77.2
```

The old peer `10.77.77.2` was not connected. The rule intercepted traffic before Docker's Pangolin DNAT rules, so public requests never reached Gerbil/Traefik. Newt uses the public Pangolin hostname for token bootstrap, so its requests were diverted by the same rule and all sites went offline.

### Recovery-specific secondary failure: stale Traefik network namespace

The compose file uses `network_mode: service:gerbil` for Traefik. This makes Gerbil's namespace the published-port namespace. Restarting Gerbil independently created a new kernel network namespace while the existing Traefik process remained in the old one. Docker metadata still showed `network_mode: container:<gerbil-id>`, but the namespace IDs differed.

The current Gerbil namespace had Gerbil listeners on `8443` and `3004`, but no Traefik listeners on `80` or `443`. Traefik's old namespace still had `80`, `443`, and `8080`. Docker's `.150:80/443` proxies therefore forwarded to a namespace without Traefik, producing `connection refused` even though Traefik's own API looked healthy.

### Contributing factors

- Legacy VPS service and Kubernetes `wg-gateway` resources were left behind after the Pangolin migration.
- The old WireGuard `PostDown` did not specify the `nat` table, so stopping the service did not remove the stale DNAT automatically.
- Firewall code and persisted rules still allowed the retired UDP `51822` relay.
- There was no boot-time assertion that the old service, interface, DNAT, or port had returned.
- The compose restart procedure did not treat Gerbil and Traefik as one lifecycle unit.
- The recovery checks initially verified container health but not network-namespace identity and listener ownership.

## Fix Steps

1. Disabled and stopped `wg-quick@wg-jellyfin.service` on the VPS.
2. Removed the stale `.150:80/443 -> 10.77.77.2` DNAT and the remaining UDP `51822` firewall accepts.
3. Deleted `/etc/wireguard/wg-jellyfin.conf` after confirming the interface was inactive.
4. Recreated only Traefik with `docker compose up -d --no-deps --force-recreate traefik` so it joined the current Gerbil namespace.
5. Removed the Argo Application and legacy `manifests/wg-gateway/` files from the local desired state. This has not been pushed, so the three legacy pods are still live.
6. Updated the tracked firewall script and operational documentation to describe Pangolin/Gerbil as the only public gateway.
7. Verified Pangolin returned HTTP `200` over IPv4 and IPv6 from the VPS.
8. Verified all three Newt pods established tunnels and remained `Ready`.
9. Verified `wg0` remained active and primary-IP listeners stayed separate.

## Prevention

These are candidates for the follow-up decision, not all implemented fixes:

1. Push the prepared GitOps deletion after confirming the old gateway is no longer needed as a rollback path.
2. Add a boot-time check for the retired systemd unit, interface, `51822`, `10.77.77.2`, and old `.150:80/443` DNAT.
3. Run Gerbil and Traefik as one restart unit, or automatically recreate Traefik whenever Gerbil is recreated.
4. After every VPS/Docker restart, verify namespace identity, listeners in Gerbil's namespace, Pangolin over IPv4 and IPv6, and all Newt readiness states.
5. Monitor Newt crash loops, Pangolin site-offline state, and unexpected public PREROUTING rules.
6. Keep `.149` primary services, `.150` Pangolin services, AdGuard, and family `wg0` explicitly separated in firewall tests and runbooks.

## Evidence

- Obsidian RCA: `AI notes/Homelab Public Gateway/PANGOLIN-OUTAGE-RCA-2026-08-19.md`
- Pangolin compose networking: `vps/pangolin/docker-compose.yml`
- Current gateway firewall model: `vps/firewall/homelab-iptables.sh`
- Legacy Argo Application removed from desired state: `argo-apps/wg-gateway.yaml`
- Legacy manifests removed from desired state: `manifests/wg-gateway/`
