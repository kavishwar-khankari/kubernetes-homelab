# Quick Containment

This is the temporary split-plane rollout approved on 2026-08-11. It is not the long-term ingress-controller or platform-upgrade design.

## Ingress Plan

- `nginx` is the public ingress plane and remains on `192.168.0.40`.
- `nginx-private` is the private ingress plane on `192.168.0.43`.
- The private controller is a temporary ingress-nginx 4.13.4 deployment with two replicas, no `hostNetwork`, no `hostPort`, and no webhook.
- The application WireGuard relay forwards only to the public VIP `192.168.0.40`.
- The family WireGuard server remains on `wg0`/UDP `61115` and is not modified.

## Public DNS Records

Keep approved public names pointed at the VPS public address. Point every private name at `192.168.0.43`, including:

```text
argocd.techtronics.top
apprise.techtronics.top
sonarr.techtronics.top
radarr.techtronics.top
lidarr.techtronics.top
code-server.techtronics.top
crafty.techtronics.top
dashy.techtronics.top
frostbite.techtronics.top
grafana.techtronics.top
homepage.techtronics.top
inference.techtronics.top
letter.techtronics.top
longhorn.techtronics.top
openwebui.techtronics.top
paperless.techtronics.top
pbs.techtronics.top
proxmox-1.techtronics.top
proxmox-2.techtronics.top
proxmox-3.techtronics.top
proxmox-4.techtronics.top
qbittorent.techtronics.top
reddit-mcp.techtronics.top
router.techtronics.top
searxng.techtronics.top
tdarr.techtronics.top
truenas-2.techtronics.top
ubuntu-server-1.techtronics.top
ubuntu-server-2.techtronics.top
jdownloader2.techtronics.top
rdtclient.techtronics.top
prowlarr.techtronics.top
ariang.techtronics.top
aria2.techtronics.top
```

The private address may remain visible in public DNS. It is not a security secret; the public WireGuard path has no route to it.
Publish only A records for the IPv4-only private LoadBalancer; do not add private AAAA records until the controller Service is deliberately made dual-stack.

## Public Names

The public controller allowlist is enforced by `ValidatingAdmissionPolicy`:

```text
jellyfin.techtronics.top
immich.techtronics.top
vaultwarden.techtronics.top
ntfy.techtronics.top
nextcloud.techtronics.top
ob-lsync.techtronics.top
jellyseerr.techtronics.top
wizarr.techtronics.top
tachi.techtronics.top
librespeed.techtronics.top
stirling.techtronics.top
files-2.techtronics.top
```

Anything not explicitly listed is private.

## Activation Order

1. Push the AppProject permission and private-ingress controller changes first. `argo-apps/master-project.yaml` makes the chart repository permission GitOps-managed; apply `argo-master-app/master-project.yaml` manually only if the existing ArgoCD instance cannot refresh the project before the child Application is created. Do not include the admission policy in this push: it denies any non-compliant Ingress UPDATE, and live Ingresses are still on the public class.
2. Wait for two private controller pods, `IngressClass/nginx-private`, and LoadBalancer `192.168.0.43` to be Ready.
3. Push the remaining changes together: `ingress-security` (admission policy + egress policy), all Ingress class splits, and the gateway change.
4. Upgrade the existing `argo-cd` Helm release so `argocd.techtronics.top` uses `nginx-private`:

   ```bash
   helm upgrade argo-cd ./helm/ArgoCD --namespace default --dependency-update --values helm/ArgoCD/values.yaml
   ```
5. Point private DNS records to `192.168.0.43`; keep approved public records pointed at the VPS.
6. Confirm private names work from LAN/Tailscale and fail through the VPS from a mobile hotspot with Tailscale stopped.
7. Apply `vps/firewall/homelab-iptables.sh` from two active Tailscale SSH sessions.
8. Verify family `wg0` peers and application `wg-jellyfin` separately.
9. Reconfirm qBittorrent external API authentication at `192.168.0.75:9090` after any restart or migration.

## Residual Risk

The existing public controller is an RKE2 DaemonSet using pod networking with `hostPort` 80/443, so its hostPort path remains outside the private controller's Cilium egress policy. The immediate containment comes from removing private Ingress objects from its watched class and restricting the VPS relay to `192.168.0.40`; the maintained controller migration remains future work.

Frostbite is currently `hostNetwork` and Cilium node-selector labels are disabled, so the private egress policy permits TCP `8000` to Cilium `host`/`remote-node` entities. Narrow that rule after enabling and validating node-label selection during the planned Cilium upgrade.

## Gateway Note: VIP-DNAT broke public path; fixed with direct pod DNAT (2026-08-11)

The first attempt to pin the tunnel to `192.168.0.40` (config-revision 10-12) broke the public path and was reverted to revision 8 (`CNI-HOSTPORT-DNAT`), restoring service.

Root cause: `-j DNAT` is a terminating nat-table target. A DNAT rule at PREROUTING position 1 rewrote tunnel traffic to the MetalLB VIP and stopped chain traversal, so kube-proxy's `KUBE-SERVICES` (which maps the VIP to the ingress pod) never ran. The packet was routed to the VIP as a local address with no listener and silently dropped. Established sessions survived because conntrack holds their full NAT mapping; only new SYNs died.

Fix (config-revision 14): DNAT tunnel traffic directly to the local public-ingress pod IP (resolved from Cilium's own `CNI-HOSTPORT-DNAT` chain on each reconcile), so no second NAT hop is needed — the same destination the old hostPort path used. A POSTROUTING MASQUERADE for `RELATED,ESTABLISHED` replies exiting `wg-jellyfin` is also installed so pod replies leave the tunnel as `10.77.77.2`; without it the VPS drops them (it expects replies from the tunnel address).
