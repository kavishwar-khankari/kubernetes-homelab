# VPS Firewall

`homelab-iptables.sh` is the temporary perimeter hardening layer for `ampere-vm`. It discovers the interface carrying the default IPv4 route instead of assuming a permanent NIC name and refuses to change rules if required firewall commands are missing.

It intentionally does not modify the family VPN configuration or peer rules:

- `wg0` remains allowed for family VPN forwarding.
- UDP `61115` remains the family WireGuard listener.
- Existing `wg0` peer routes and port-forward behavior remain unchanged.
- `tun0`, Tailscale, and Docker forwarding are preserved.

Pangolin/Gerbil is the public gateway on `10.0.0.150`:

- TCP `80/443` serves the Pangolin sites on the gateway IP and its public IPv6.
- UDP `51820` carries the Pangolin site tunnels.
- The primary IP `10.0.0.149` remains separate for family VPN and local services.

The VPS's intentional public Docker services on TCP `853`, `10012`, and `10014` are allowed through Docker's forwarding chain. Other Docker publishes, including Portainer's `8000/9443`, remain blocked.

The script backs up the live IPv4 and IPv6 rules before changing them and persists the resulting rules with `netfilter-persistent`.

The VPS public IPv6 address is supplied by OCI through DHCPv6. The durable
netplan overlay for that address is tracked at `vps/network/60-ipv6.yaml` and
must be installed as `/etc/netplan/60-ipv6.yaml` on `ampere-vm`. It enables
both `dhcp6` and router-advertisement acceptance because the VPS forwards IPv6
traffic for the family VPN.

Apply only after confirming an active Tailscale SSH session and keeping a second administrative session open:

```bash
tailscale ssh root@ampere-vm 'bash -s' < vps/firewall/homelab-iptables.sh
```

Immediately verify:

```bash
tailscale ssh root@ampere-vm wg show
tailscale ssh root@ampere-vm ss -lntup
```

After installing or updating the overlay, renew the network configuration:

```bash
scp vps/network/60-ipv6.yaml root@100.119.37.82:/etc/netplan/60-ipv6.yaml
tailscale ssh root@ampere-vm 'netplan generate && netplan apply'
```

Verify that a global address and public IPv6 route returned:

```bash
tailscale ssh root@ampere-vm 'ip -6 addr show dev enp0s6; ip -6 route show default'
```

Then test family VPN connectivity before testing the public gateway. Restore the newest `/root/firewall-backups/rules.v4.*` and `rules.v6.*` with `iptables-restore` and `ip6tables-restore` if any family VPN behavior changes.

## Operational notes

- **Docker restarts**: `docker` re-inserts its own chains when it starts. If it restarts, re-run this script so `HOMELAB-FORWARD` is first again and Docker-published ports other than `853/10012/10014` stay blocked from the WAN.
- **Pangolin gateway**: Docker publishes TCP `80/443` on `10.0.0.150` and the Pangolin IPv6 address directly to Gerbil. Do not restore the retired `wg-jellyfin` DNAT.
- **IPv6**: Pangolin has a dual-stack public path on the gateway address; the primary IPv6 address remains owned by the primary-IP services.
