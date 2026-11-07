# Incident 026: Private ingress VIP unreachable when MetalLB announcer is also the Tailscale subnet router

**Date:** 2026-11-07  
**Detected:** 2026-11-07 ~06:00 UTC (user reported `chrome.techtronics.top` and `code-server.techtronics.top` timing out from the laptop outside the home network)  
**Resolved:** 2026-11-07 06:56 UTC (VIP moved to k3s-node-3)  
**Severity:** High (every private-ingress host unreachable over Tailscale)  

## Symptoms

- `chrome.techtronics.top`, `code-server.techtronics.top`, and all other private-ingress hosts timed out from the laptop over Tailscale.
- `ping 192.168.0.43` from the laptop returned `From 192.168.0.161 icmp_seq=1 Destination Host Unreachable`.
- `curl` to `https://192.168.0.43` timed out after the TCP connect never completed.
- `k9s` over Tailscale still worked (API endpoint `192.168.0.160:6443`).
- From `dev-vm` (`192.168.0.30`), the same hostnames returned `200` / `302` normally.
- On `k3s-node-1`: `ip neigh show 192.168.0.43` reported `FAILED`.

## Affected

| Service | Host | Path |
|---------|------|------|
| Kasm Chrome | `chrome.techtronics.top` | `192.168.0.43:443` → `192.168.0.30:6901` |
| code-server | `code-server.techtronics.top` | `192.168.0.43:443` → `192.168.0.30:8080` |
| OpenChamber | `openchamber.techtronics.top` | `192.168.0.43:443` → `192.168.0.30:3000` |
| All other private ingress | `*.techtronics.top` via `nginx-private` | `192.168.0.43:443` |

## Root Cause

1. **MetalLB L2 VIP was announced from k3s-node-1.** `192.168.0.43` is a MetalLB L2 VIP, not an address assigned to any interface. The speaker on k3s-node-1 answered ARP for it and kube-proxy DNATed the VIP to the ingress-nginx pod. The `nodeAssigned` event and speaker logs confirmed `announcing from node "k3s-node-1"`.

2. **The laptop's Tailscale subnet router was also k3s-node-1.** The laptop's `192.168.0.0/24` route went over `tailscale0` to the subnet-router pod on k3s-node-1 (`192.168.0.161`). To forward the laptop's packets to `192.168.0.43`, node-1 had to ARP for the VIP.

3. **A node cannot ARP its own MetalLB VIP.** MetalLB's ARP responder is a user-space process listening on the physical interface. It answers ARP requests received from the wire, but never sees ARP requests generated locally by its own node. Node-1 therefore had `192.168.0.43 ... FAILED` and returned `Destination Host Unreachable` for the forwarded packets.

4. **Other paths worked, which masked the distinction.** `k9s` uses `192.168.0.160`, a kube-vip address bound locally on the node, so no ARP forwarding is involved. `curl` from `dev-vm` worked because the VM is a different host; its ARP request was answered by node-1 over the wire.

5. **Contributing factor: MetalLB was advertising from all interfaces.** The `L2Advertisement` had no `interfaces` list, so the speaker also created ARP responders on Cilium pod veths (`lxc*`). Speaker logs showed `deleteARPResponder interface=lxc395da76485bb` followed by a re-announce, leaving ARP resolution unreliable. The ARP responders were pinned to `enp6s18` in commit `e16fcb0`, and the node-1 speaker was restarted to rebind.

## Fix Steps

| Step | Action |
|------|--------|
| 1 | Added `interfaces: [enp6s18]` to `L2Advertisement/strong-nodes-only` in `manifests/metal-lb/metallb-ip-pool.yaml`; committed as `e16fcb0` and synced by ArgoCD (`metal-lb`: Synced/Healthy). |
| 2 | Restarted the MetalLB speaker pod on k3s-node-1 to force the ARP responder to rebind to `enp6s18`. |
| 3 | Removed the `metallb-announce=true` label from `k3s-node-1` and `k3s-node-2`, leaving only `k3s-node-3` eligible. Node-3 carries `minecraft-server=true`, which the Tailscale DaemonSet explicitly excludes, so the announcer can never be a Tailscale subnet router. MetalLB re-elected node-3 within seconds (`serviceAnnounced` on `speaker-2f5cv`, `serviceWithdrawn ... notOwner` on `speaker-fbc4h`). |
| 4 | Verified: VIP MAC changed to node-3's NIC (`bc:24:11:19:bc:5e`), `curl` from the VM returned `200`, and a raw TCP SYN from k3s-node-1 to `192.168.0.43:443` now received `SYN-ACK`. |
| 5 | Interim workaround while diagnosing: accessed Kasm and code-server via the VM's Tailscale IP (`https://100.67.204.85:6901`, `http://100.67.204.85:8080`). |

**Operational note:** steps 2 and 3 were applied imperatively with `kubectl`. Step 1 is in git and ArgoCD-managed. Node labels are not currently managed by git.

## Prevention

- [x] Pin MetalLB L2 announcements to the physical NIC (`interfaces: [enp6s18]`) so pod veth churn cannot delete the responder.
- [x] Keep the MetalLB announcer and the Tailscale subnet router on disjoint nodes. Currently MetalLB announces only from `k3s-node-3`, which has no Tailscale pod.
- [x] Made the node invariant declarative in git: the `L2Advertisement` now selects `minecraft-server: "true"` (commit `b062e95`). The Tailscale DaemonSet requires that label to be absent, so the announcer can never also be a subnet router, even if `metallb-announce` is re-added to node-1 or node-2.
- [ ] Add a check that alerts when `ip neigh show 192.168.0.43` is `FAILED` on any node running a Tailscale subnet router, or when the VIP announcer changes to a node that also runs a subnet router.
- [ ] Document the accepted trade-off: with only `k3s-node-3` eligible, if node-3 is down the VIP is not announced at all (no L2 failover).
- [ ] Consider the alternative invariant: make `dev-vm` the only Tailscale subnet router, since it can never be a MetalLB announcer.

## Related

- [016](./016-private-ingress-404-tailscale-subnet-router-path.md) — previous private-ingress failure over a Tailscale subnet-router path (stale `ubuntu-lxc` router), different root cause.
