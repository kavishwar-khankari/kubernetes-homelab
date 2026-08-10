# VPS Firewall

`homelab-iptables.sh` is the temporary perimeter hardening layer for `ampere-vm`. It discovers the interface carrying the default IPv4 route instead of assuming a permanent NIC name and refuses to change rules if required firewall commands are missing.

It intentionally does not modify the family VPN configuration or peer rules:

- `wg0` remains allowed for family VPN forwarding.
- UDP `61115` remains the family WireGuard listener.
- Existing `wg0` peer routes and port-forward behavior remain unchanged.
- `tun0`, Tailscale, and Docker forwarding are preserved.

The application relay is separate:

- `wg-jellyfin` UDP `51822` remains the application WireGuard listener.
- Only TCP `80/443` may forward from the public interface to `10.77.77.2`.
- Other traffic from the application relay is dropped.

The VPS's intentional public Docker services on TCP `853`, `10012`, and `10014` are allowed through Docker's forwarding chain. Other Docker publishes, including Portainer's `8000/9443`, remain blocked.

The script backs up the live IPv4 and IPv6 rules before changing them and persists the resulting rules with `netfilter-persistent`.

Apply only after confirming an active Tailscale SSH session and keeping a second administrative session open:

```bash
tailscale ssh root@ampere-vm 'bash -s' < vps/firewall/homelab-iptables.sh
```

Immediately verify:

```bash
tailscale ssh root@ampere-vm wg show
tailscale ssh root@ampere-vm ss -lntup
```

Then test family VPN connectivity before testing the public gateway. Restore the newest `/root/firewall-backups/rules.v4.*` and `rules.v6.*` with `iptables-restore` and `ip6tables-restore` if any family VPN behavior changes.

## Operational notes

- **Docker restarts**: `docker` re-inserts its own chains when it starts. If it restarts, re-run this script so `HOMELAB-FORWARD` is first again and Docker-published ports other than `853/10012/10014` stay blocked from the WAN.
- **App relay DNAT**: the PREROUTING `10.0.0.150:80/443 -> 10.77.77.2` DNAT lives in the persisted NAT rules and is not created by this script. After a NAT flush or a fresh VPS, restore that rule before testing the public gateway.
- **IPv6**: the VPS has a public IPv6 address, but the application relay has no IPv6 path. Keep app DNS records A-only (no AAAA), or IPv6 clients would reach the local nginx default server instead of the cluster ingress.
