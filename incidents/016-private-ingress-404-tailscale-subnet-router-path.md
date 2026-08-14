# Incident 016: Private ingress (192.168.0.43) 404/403 through Tailscale subnet-router path

## Date
2026-08-14
**Resolved:** 2026-08-14

## Symptoms
- All `nginx-private` services (`*.techtronics.top` private names pointed at
  `192.168.0.43`) returned `404 Not Found` (default-backend page) — reported
  as "403 not found" — from the workstation.
- Public services (`jellyfin`, `argocd`, …) worked from the same device.
- The same private names opened normally from a phone on the same WiFi.
- **Confirmed on mobile-data + Tailscale:** the same phone over cellular with
  Tailscale enabled reproduced the identical `404` — proving the failure
  tracks the Tailscale overlay path, not the physical network.
- Direct probes against the `.43` VIP:
  - Workstation (`curl -H "Host: homepage.techtronics.top" https://192.168.0.43/`)
    → `HTTP 404`; the identical request with a public host (`jellyfin`,
    `argocd`) → `302`/`200` — i.e. **public-ingress behavior**.
  - LAN-direct (mobile, or `wg-jellyfin` host-netns pod on k3s-node-1/2) with
    `homepage.techtronics.top` → `HTTP 200` — i.e. **private-ingress behavior**.

## Affected
- The workstation (this Linux box, `192.168.0.7`): policy-routes the LAN
  subnet through Tailscale (table 52 → `tailscale0`), so `.43` traffic egresses
  via the legacy `ubuntu-lxc` subnet router (`100.99.119.55` / `192.168.0.165`).
- Any tailnet client that routes `192.168.0.0/24` via `ubuntu-lxc`. Direct-LAN
  clients (phone, k3s nodes, etc.) were unaffected.

## Root Cause
The private ingress plane is healthy; the failure is in the client's network
path through a stale Tailscale subnet router.

1. **Client path picks a legacy subnet router.** The workstation routes
   `192.168.0.0/24` via `tailscale0` (`ip rule … lookup 52`). Tailscale resolves
   the `/24` to `ubuntu-lxc` (`100.99.119.55`), the only peer on the tailnet
   whose `192.168.0.0/24` route is visible/approved — the k3s-node subnet-router
   DS routes are not advertised/approved, so clients are funneled onto the
   legacy container instead.

2. **`ubuntu-lxc` forwards `.43` to the PUBLIC ingress plane.** Evidence:
   the public controller's access log (`rke2-ingress-nginx-controller` on
   k3s-node-2) shows the workstation's `curl https://192.168.0.43` requests
   served with `client: 192.168.0.165`:
   - `GET /` `Host: jellyfin.techtronics.top` → `302 [jellyfin-jellyfin-8096]`
   - `GET /` `Host: argocd.techtronics.top` → `200 [default-argo-cd-argocd-server-80]`
   Private hosts (e.g. `homepage`) are not configured on the public controller,
   so they hit its default backend → `404`. `ubuntu-lxc` is SNAT/DNAT-ing `.43`
   HTTP(S) to the public controller instead of leaving it on the private plane.

3. **The `.43` private plane is fine.** `private-ingress-nginx-controller`
   pods `Running`; `IngressClass nginx-private` → controller
   `k8s.io/ingress-nginx-private` matches; nginx.conf contains all private
   `server_name` blocks; endpoints populated. LAN-direct access to `.43`
   returns the correct app (`homepage` → 200).

### Secondary findings (not the cause, latent risk)
- kube-proxy on k3s-node-2 has **no** `KUBE-EXT` rules for `192.168.0.43`
  (present on k3s-node-1 and k3s-node-3), plus a recurring hourly
  `Failed to start healthcheck … 0.0.0.0:31241: bind: address already in use`
  error. In-cluster clients to `.43` time out; only kube-vip's own forwarding
  keeps LAN-direct working.
- kube-vip VIPs `.40`/`.41`/`.42`/`.43` on k3s-node-2 show as `deprecated` on
  `enp6s18`.
- **kube-vip was wrongly serving the app LoadBalancers:** the kube-vip
  DaemonSet (RKE2 addon) ran `svc_enable=true`, so it hijacked every app LB
  (`.40`–`.43`) in parallel with MetalLB, causing the `deprecated` VIP state
  and ARP contention. Intended design: kube-vip = control-plane VIP
  (`192.168.0.160`) only; MetalLB = all app/service LBs.

## Fix Steps
1. **Root fix applied (Tailscale admin console):** disabled `ubuntu-lxc`'s
   `192.168.0.0/24` subnet-route allowance. Tailnet clients immediately
   re-routed the LAN subnet through the cluster tailscale subnet routers
   (`k3s-node-1-ts` / `k3s-node-2-ts`, which advertise the same `/24` via
   `manifests/tailscale/ds.yaml`), and private names on `.43` started
   resolving correctly — verified from the workstation and mobile-data +
   Tailscale. No cluster-side change was required.
2. **Workstation (was not needed after the above):** stop routing the LAN
   subnet through Tailscale while on the LAN (`sudo ip rule add to
   192.168.0.0/24 lookup main pref 5000`) or pin `.43` to the direct path.
3. **Retire/fix the legacy `ubuntu-lxc` subnet router:** it still carries a
   stale DNAT/proxy that sends `192.168.0.43:80/443` to the public ingress
   (public controller logged `client: 192.168.0.165`). With its route
   allowance disabled it no longer receives tailnet traffic, but the
   forwarding rule should still be removed from the LXC to prevent future
   misdirection.
4. **Cluster hardening (2026-08-14, done):** made kube-vip control-plane-only
   and let MetalLB own the app LBs:
   - Persisted `svc_enable: "false"` in the RKE2 addon manifest on the primary
     node (`/var/lib/rancher/rke2/server/manifests/kube-vip.yaml`); the addon
     controller re-applied it (DS now `cp=true svc=false`, all pods restarted,
     only `.160` broadcast).
   - Removed the stale `.40`–`.43` addresses from k3s-node-2's `enp6s18`
     (kube-vip no longer manages them; they were left behind and still
     answering ARP).
   - MetalLB (already announcing `.40`–`.43` from its speakers) is now the sole
     owner; verified: `.43` private ingress → 200, `.40` public → works, all
     nodes Ready, `.160` control-plane VIP serves the API.
   - **Remaining:** kube-proxy on k3s-node-2 still lacks the `.43` rules and
     still fails the port-31241 healthcheck bind even after a pod restart
     (pod shows a container-restore quirk: `created=09:16`, `started=08-04`).
     Non-blocking for MetalLB (it announces `.43` from k3s-node-1, which has
     the rules + local endpoints), but needs a host-level look (reboot or
     stale-process cleanup on the node).

## Prevention
- Keep exactly one approved subnet router per advertised LAN subnet on the
  tailnet; verify with `tailscale status` / admin console after any change.
- When a subnet router is replaced, **disable the old router's route
  allowance before or at the same time as enabling the replacement** — stale
  router + stale VIP forwarding is what misrouted `.43` to the public plane.
- After any networking rollout (subnet-router, VIP, ingress split-plane),
  re-test a private name from both a direct-LAN client and a Tailscale-routed
  client against the private VIP.
- Add `.43` private hosts to the public controller's default-backend check:
  a private host answered by the public controller is a routing misdirection
  signal.
