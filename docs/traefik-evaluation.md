# Traefik Proxy Evaluation — Public Ingress / Gateway API Controller

**Date:** 2026-08-10 · **Research only** (no cluster changes made)
**Context:** 3-node RKE2 + Cilium + MetalLB homelab; legacy ingress-nginx stays private; candidate: Traefik Proxy as the public controller (Ingress + Gateway API). All claims cite primary sources (Traefik docs/repo, Gateway API repo, RKE2 docs, GitHub advisories).

## Fit Verdict

**FIT — with conditions.** Traefik is the direction the ecosystem and Rancher itself are moving: ingress-nginx is EOL (retirement announced March 2026, no security patches after), and **RKE2 makes Traefik the default ingress controller for new clusters starting v1.36** with an official migration guide. Traefik v3.7 is actively maintained (v3.7.10, 2026-07-31), publishes a Gateway API v1.6.1 conformance report with **0 failures**, has a first-party nginx-annotation compatibility provider (v3.6.2+) plus an official migration tool, and covers every capability this repo needs (wildcard default cert, PROXY protocol, backend HTTPS with CA control, WebSocket/SSE, streaming 100GB uploads with timeout tuning, TCP/UDP, rate limiting, HA).

Conditions to handle during migration:

1. **Pin the class boundary explicitly.** With `providers.kubernetesIngress.ingressClass` unset, Traefik claims *all* Ingresses including `nginx`-classed ones (traefik/traefik#11820). Set `ingressClass: traefik`, or use the nginx-compat provider's `ingressClass`/`controllerClass` scoping per the RKE2 guide, so the controllers never fight; both controllers writing `.status` on the same Ingress causes update conflicts.
2. **Raise entrypoint timeouts.** Traefik `readTimeout` default is **60s** (0 = unlimited). The 100GB Immich upload and the repo's 3600s nginx timeouts require `transport.respondingTimeouts.readTimeout` at the entrypoint — there is no per-router read timeout (open P1 request: traefik/traefik#10962).
3. **Three current annotations do not carry over** through the nginx-compat layer: `limit-rate`/`limit-rate-after` (jellyfin), `upstream-hash-by` (crafty IP-hash; only cookie persistence supported), and raw `server-snippets` (crafty; `allowSnippetAnnotations` off by default, subset of directives only). Convert to Traefik RateLimit/Headers middlewares.
4. **Patch promptly.** v3.7.10 fixed three CVEs including a **High (CVSS 7.6)** Gateway API route-identity-collision allowing cross-namespace backend hijacking (CVE-2026-71327). Only the latest minor (3.7) is under active support.
5. **CRDs are Helm-managed** (`crds/` dir in chart). ArgoCD's `helm template` path doesn't emit them — apply Traefik CRDs (and Gateway API CRDs) via a dedicated ArgoCD app; budget for CRD upgrades on chart bumps (v41.2.0 includes a CRD update).

---

## 1. Maintained versions

- Traefik Proxy **v3.7.10** (2026-07-31), latest stable, ships 3 CVE fixes. https://github.com/traefik/traefik/releases/tag/v3.7.10
- Helm chart **v41.2.0** (2026-08-07), supports Traefik v3.6.0→v3.7.10; note "includes a CRD update" in release notes. https://github.com/traefik/traefik-helm-chart/releases/tag/v41.2.0
- Support policy: **only the latest minor (3.7) on active support**; 3.6 active support ended 2026-05-05; v2.11 security support ended 2026-02-01. https://doc.traefik.io/traefik/deprecation/releases/
- RKE2: Traefik becomes the **default ingress controller for new clusters starting v1.36**; ingress-nginx EOL March 2026. https://docs.rke2.io/reference/ingress_migration · https://kubernetes.io/blog/2025/11/11/ingress-nginx-retirement/

## 2. IngressClass coexistence (Traefik public + nginx private)

- Multiple controllers coexist via `ingressClassName`; the chart creates its own IngressClass (`isDefaultClass` default true — set false in a dual-controller setup). https://github.com/traefik/traefik-helm-chart/blob/master/traefik/values.yaml
- **Caveat (confirmed bug):** with `providers.kubernetesIngress.ingressClass` unset, Traefik claims Ingresses of other classes too, and status writes conflict. Set `ingressClass` explicitly. https://github.com/traefik/traefik/issues/11820
- RKE2 official dual-controller migration uses compat `controllerClass: rke2.cattle.io/ingress-nginx-migration` and disables Traefik's published service to avoid races. https://docs.rke2.io/reference/ingress_migration
- nginx-compat provider scoping (ingressClass, controllerClass, watchIngressWithoutClass, publishService): https://doc.traefik.io/traefik/reference/install-configuration/providers/kubernetes/kubernetes-ingress-nginx/

## 3. Gateway API support & conformance

- Supports spec **v1.6.1**: full HTTPRoute core; extended BackendTLSPolicy, GRPCRoute, TLSRoute (Standard channel), TCPRoute (Experimental channel, enable via `experimentalChannel`). **UDPRoute NOT supported** (UDP only via IngressRouteUDP CRD). https://doc.traefik.io/traefik/reference/routing-configuration/kubernetes/gateway-api/
- Conformance report (v1.6, Traefik v3.7.10, experimental): GATEWAY-HTTP core 36 passed / 0 failed / 1 skipped (HTTPRouteMultipleGateways), extended 26/26; GRPC 15/15; TLS 20/20 core + 4/4 extended; 7 provisional tests pass. https://github.com/kubernetes-sigs/gateway-api/tree/main/conformance/reports/v1.6/traefik-traefik (experimental-v3.7.10-default-report.yaml)
- Unsupported extended features (use middlewares instead): HTTPRouteRequestTimeout, HTTPRouteRetry, HTTPRouteRequestMirror, HTTPRouteCORS. Traefik middlewares can attach to HTTPRoutes via `traefik.io/http-route-filter` extension.
- Gateway `status.addresses` copies from the chart's LoadBalancer Service (MetalLB IP) — chart `providers.kubernetesGateway.statusAddress.service`.

## 4. Helm / GitOps installation

- Chart defaults: Deployment kind, `replicas: 1`, PDB optional, probes on `/ping` (port 8080), `service.type: LoadBalancer`, `single: true` (TCP+UDP mixed LB), hardened securityContext (runAsNonRoot 65532, drop ALL caps, RO rootfs, seccomp RuntimeDefault), `resources: {}` (set your own), image pinning by digest supported (`image.digest` + `versionOverride`). https://github.com/traefik/traefik-helm-chart/blob/master/traefik/values.yaml
- Chart ships CRDs in `traefik/crds/` — installed by `helm install`, **not** emitted by `helm template` (ArgoCD). Plan a separate CRD app + Gateway API CRD app. https://github.com/traefik/traefik-helm-chart/tree/master/traefik/crds
- RKE2 alternative: bundled `rke2-traefik` HelmChart in kube-system configured via HelmChartConfig (ports 8000/8443 during migration). https://docs.rke2.io/reference/ingress_migration

## 5. MetalLB LoadBalancer

- Standard pattern: chart `service.spec.type: LoadBalancer` + MetalLB L2; works with the repo's `lan-pool`/`metallb-announce` setup. Real-world RKE2+MetalLB examples use `metallb.io/loadBalancerIPs` annotations, dual-stack, `externalTrafficPolicy: Local` (preserves client IP; health checks on the internal port). https://github.com/traefik/traefik/issues/12917 · https://github.com/traefik/traefik/issues/11820
- Chart `publishedService` copies the LB IP into Ingress `.status`; Gateway `statusAddress.service` does the same for Gateways (external-dns friendly).

## 6. PROXY protocol / client IP

- EntryPoint `proxyProtocol.trustedIPs` (v1+v2, auto-detected; `insecure` for tests only) and `forwardedHeaders.trustedIPs` (X-Forwarded-* trust), plus `notAppendXForwardedFor`. Traefik adds X-Forwarded-For / X-Real-Ip / X-Forwarded-Host / -Port / -Proto / -Server by default. https://doc.traefik.io/traefik/reference/install-configuration/entrypoints/ · https://doc.traefik.io/traefik/getting-started/faq/
- nginx ConfigMap `use-proxy-protocol` maps to entrypoint `proxyProtocol` (official migration guide mapping table). https://doc.traefik.io/traefik/migrate/nginx-to-traefik/
- With MetalLB L2 + `externalTrafficPolicy: Local`, source IP arrives natively; PROXY protocol only needed if a L4 LB fronts Traefik.

## 7. Wildcard / default TLS

- `TLSStore` CRD `defaultCertificate.secretName` serves the default cert for connections without SNI match — 1:1 equivalent of this repo's `--default-ssl-certificate=kube-system/techtronics-wildcard-tls` (chart `tlsStore` values create the CRD). https://doc.traefik.io/traefik/reference/routing-configuration/kubernetes/crd/tls/tlsstore/
- Wildcard SANs are handled by best-match selection among store certificates (cache 1h, reset on config change). cert-manager can keep renewing the wildcard; Traefik also supports ACME certResolvers (incl. DNS-01) natively. https://doc.traefik.io/traefik/getting-started/faq/ · https://doc.traefik.io/traefik/reference/routing-configuration/http/tls/overview/

## 8. Backend HTTPS & CA verification

- `ServersTransport` (static or CRD): `serverName`, `rootCAs`, `insecureSkipVerify`, `certificates`, `cipherSuites`, `min/maxVersion`, `disableHTTP2`, `forwardingTimeouts.{dialTimeout,responseHeaderTimeout,idleConnTimeout,readIdleTimeout,pingTimeout}`, SPIFFE peer certs. https://doc.traefik.io/traefik/reference/routing-configuration/http/load-balancing/serverstransport/
- Crafty mapping: nginx `backend-protocol: HTTPS` + `proxy-ssl-verify: "false"` → ServersTransport with `insecureSkipVerify: true` (or better: `rootCAs` + proper verification). Note open bug: HTTP/2 to HTTPS backends can prematurely close connections since v3.1.7 — workaround `disableHTTP2: true` in the transport (traefik/traefik#11986).

## 9. WebSockets / SSE

- "Traefik Proxy supports WebSocket (WS) and WebSocket Secure (WSS) connections out of the box. No special configuration is required beyond standard HTTP routing." https://doc.traefik.io/traefik/expose/overview/ (docs source: docs/content/expose/overview.md)
- SSE/long-lived responses stream by default (no response buffering unless the Buffering middleware is attached). HTTP/2 & HTTP/3 entrypoints supported (HTTP/3 needs dual TCP/UDP service).

## 10. 100GB streaming uploads / long timeouts / buffering

- Request bodies are **streamed by default** (no buffering unless a `buffering` middleware is attached; Traefik's nginx-compat default `proxyRequestBuffering: false` vs nginx's on). The `buffering` middleware (CRD) caps `maxRequestBodyBytes` (0 = unlimited; 413 over limit) and spills to disk past `memRequestBodyBytes` (1MB default). https://doc.traefik.io/traefik/reference/routing-configuration/http/middlewares/buffering/
- EntryPoint `transport.respondingTimeouts`: **readTimeout default 60s, writeTimeout 0, idleTimeout 180s** — for Immich's 100GB uploads set `readTimeout: 0` (or large) on `websecure`, mirroring the current `proxy-read-timeout: 3600`. Timeouts are entrypoint-global; per-router timeout is an open P1 request (#10962). https://doc.traefik.io/traefik/reference/install-configuration/entrypoints/
- nginx `proxy-body-size: 100g` / `proxy-request-buffering: off` → in Traefik: no buffering middleware + entrypoint readTimeout raised; `proxy-body-size` limits map to `maxRequestBodyBytes` if a cap is wanted.

## 11. TCP / UDP

- TCP: Gateway API TCPRoute (experimental channel) + `IngressRouteTCP` CRD; UDP: **only** `IngressRouteUDP` CRD (no UDPRoute). TCP/UDP entrypoints are first-class (`address: :port/udp`). https://doc.traefik.io/traefik/reference/routing-configuration/kubernetes/gateway-api/ · https://doc.traefik.io/traefik/reference/routing-configuration/kubernetes/crd/udp/ingressrouteudp/
- Chart `service.single: true` exposes TCP+UDP on one LB service (MixedProtocolLBService).

## 12. Middleware / auth / rate-limit

- Rich middleware catalog (CRDs, attachable to IngressRoutes, HTTPRoutes via `traefik.io/http-route-filter`, or Ingress via annotations): BasicAuth, DigestAuth, ForwardAuth, IPAllowList, RateLimit (token bucket, `average`/`burst`/`period`, **Redis-distributed**), InFlightReq (concurrent), Headers, Redirect*, StripPrefix*, Compress, CircuitBreaker, Retry, Errors, Buffering, PassTLSClientCert, etc. https://doc.traefik.io/traefik/reference/routing-configuration/http/middlewares/ratelimit/ (index: doc.traefik.io/traefik/reference/routing-configuration/http/middlewares/)
- Repo mapping: searxng/reddit-mcp basic auth → BasicAuth middleware (compat: `auth-type`/`auth-secret`/`auth-realm` are auto-translated); ntfy `limit-rps: 30`/`limit-connections: 50` → RateLimit + InFlightReq (compat layer translates limit-rps/limit-connections; note nginx leaky-bucket vs Traefik token-bucket difference); jellyfin `limit-rate`/`limit-rate-after` → **unsupported**, use RateLimit middleware or drop.
- Ingress-nginx compat behavior differences (forward-auth semantics, CORS preflight, path trailing slashes, retry to same server possible, rate-limit algorithm): https://doc.traefik.io/traefik/reference/routing-configuration/kubernetes/ingress-nginx/

## 13. Security history / current advisories

- **v3.7.10 fixed (2026-07-31):**
  - **CVE-2026-71327 / GHSA-fgjj-px3w-67xx — High 7.6**: Gateway API route identity collision → cross-namespace backend hijacking (all v3 ≤3.6.24 / 3.7.9; patched 3.6.25/3.7.10). https://github.com/traefik/traefik/security/advisories/GHSA-fgjj-px3w-67xx
  - **CVE-2026-71325 / GHSA-62fc-8686-hfmq — Medium**: `allowCrossNamespace=false` bypass via `@kubernetescrd` TraefikService backendRefs (patched 2.11.54/3.6.25/3.7.10). https://github.com/traefik/traefik/security/advisories/GHSA-62fc-8686-hfmq
  - **CVE-2026-71326 / GHSA-6765-c87h-8mrf — Low**: BasicAuth singleflight key collision → identity spoofing via headerField (patched 3.6.25/3.7.10). https://github.com/traefik/traefik/security/advisories/GHSA-6765-c87h-8mrf
- Response is rapid (advisories published 2026-08-03, patched release 2026-07-31), but only the latest minor is maintained — staying current is mandatory. Historical context: 2024 CVEs (e.g. GHSA-4vwx-54mw-vqfw, CVE-2024-28869) drove entrypoint security hardening options.

## 14. Resource footprint

- Chart default `resources: {}`; hardened pod defaults; typical idle footprint is low (single-digit % CPU, tens of MB RSS class) — no official benchmark published; RKE2's resource profiling covers whole-node, not per-component. Real-world RKE2 deployments request e.g. 300m/2200Mi (generous) and run 2-5 replicas comfortably. https://docs.rke2.io/reference/resource_profiling · https://github.com/traefik/traefik/issues/12917
- `goMemLimitPercentage: 0.9` (GOMEMLIMIT) option in chart for predictable memory.

## 15. HA

- Multiple replicas supported (no leader election needed for k8s providers — each replica derives config from the same cluster state; LB service load-balances across pods). Chart: `deployment.replicas`, rolling update `maxUnavailable: 0 / maxSurge: 1`, PDB support, topologySpreadConstraints/anti-affinity examples for node spread. https://github.com/traefik/traefik-helm-chart/blob/master/traefik/values.yaml
- Note: the nginx-compat provider caveat list explicitly says "Leader Election: Not supported" for that compat mode (each replica is independent) — https://doc.traefik.io/traefik/reference/routing-configuration/kubernetes/ingress-nginx/
- MetalLB L2 announces to healthy endpoints; with `externalTrafficPolicy: Local`, pod loss fails over the LB IP to another node with a healthy pod. Single-replica = outage window on pod loss.

## 16. CRD coupling

- Traefik CRDs (IngressRoute/TCP/UDP, Middleware, TLSOption, TLSStore, ServersTransport, TraefikService) + Gateway API CRDs are the config surface. Chart bundles its CRDs in `crds/`; chart upgrades can ship CRD updates (v41.2.0 does) requiring coordinated apply. Gateway API CRDs installed separately (v1.6.1) — needed for the Gateway provider.
- ArgoCD implications: `helm template` excludes `crds/`; manage CRDs via a dedicated app/step, then the Traefik app. This is the main GitOps operational burden vs. plain nginx.

## 17. Migration effort from nginx annotations (repo-specific)

- Official guides: zero-downtime migration doc + annotation-compat reference + migration analyzer tool. Requires Traefik ≥ v3.6.2. https://doc.traefik.io/traefik/migrate/nginx-to-traefik/ · https://doc.traefik.io/traefik/reference/routing-configuration/kubernetes/ingress-nginx/ · https://github.com/traefik/ingress-nginx-migration
- Repo inventory (all under `manifests/*/ingress.yaml`, `helm/*/values.yaml`):
  - `proxy-read-timeout/send-timeout: 1800/3600` → compat provider options `proxyReadTimeout`/`proxySendTimeout` (int seconds) or entrypoint timeouts — **note default 60s must be raised**. ✅ supported
  - `proxy-body-size` (10m–525m; immich `100g`) → `proxyBodySize` / no cap for immich (streaming default). ✅ supported
  - `proxy-request-buffering: off` (immich, librespeed, stirling-pdf) → Traefik default (false) matches. ✅
  - `proxy-buffering: off/on` (crafty, reddit-mcp, jellyfin) → `proxyBuffering` provider option. ✅
  - `auth-type/secret/realm` (searxng, reddit-mcp) → auto-translated. ✅
  - `limit-rps`/`limit-connections` (ntfy) → translated (token-bucket semantics differ). ✅ with caveat
  - `limit-rate`/`limit-rate-after` (jellyfin) → **unsupported** ❌ → Traefik RateLimit middleware
  - `backend-protocol: HTTPS` + `proxy-ssl-verify: false` (crafty) → ServersTransport insecureSkipVerify / rootCAs ✅ (mind #11986 HTTP/2 bug → disableHTTP2)
  - `proxy-http-version: 1.1`, `upstream-hash-by: $remote_addr` (crafty) → `upstream-hash-by` **unsupported** ❌ (only cookie persistence) → drop or Headers/custom LB
  - `server-snippets` (crafty) → **unsupported** ❌ (`allowSnippetAnnotations` off by default; subset of directives) → translate to middlewares
- Phase-in path per RKE2 guide: run Traefik on temp ports alongside nginx with a migration IngressClass, flip `ingressClassName` app-by-app, then retire nginx for public traffic.

## 18. Failure modes

- **Routing config errors are non-fatal**: invalid dynamic resources are dropped with logged errors; no nginx-style reload loop (FAQ: 404/502/503 semantics — 404 when no router matches, 502 upstream error, 503 when matched router has no servers). https://doc.traefik.io/traefik/getting-started/faq/
- **Static config errors are fatal at startup** (invalid flags/entrypoints → process exits; k8s restarts it).
- **Silent config-overwrite class of bugs existed** (CVE-2026-71327 route identity collision — fixed in 3.7.10; keep patched).
- **Timeout defaults bite streaming**: 60s readTimeout aborts slow/large uploads until raised (documented above).
- **Dual-controller hazards**: IngressClass ownership confusion (#11820) and status-address write conflicts (#12917, RKE2 guide) — mitigated by explicit classes and publishService disable.
- **HTTP/2 backend connection close bug** since v3.1.7 (#11986, open) — affects HTTPS backends (crafty); workaround disableHTTP2.
- **Pod loss**: replicas>1 + MetalLB failover; single replica = LB has no endpoints → 503/connection refused until restart.
- **CRD drift**: missing/outdated CRDs on chart upgrade → provider errors; coordinate CRD apply in GitOps.

## Evidence URLs (primary sources)

- Releases: https://github.com/traefik/traefik/releases/tag/v3.7.10 · https://github.com/traefik/traefik-helm-chart/releases/tag/v41.2.0
- Support policy: https://doc.traefik.io/traefik/deprecation/releases/
- Gateway API: https://doc.traefik.io/traefik/reference/routing-configuration/kubernetes/gateway-api/ · conformance: https://github.com/kubernetes-sigs/gateway-api/tree/main/conformance/reports/v1.6/traefik-traefik
- nginx compat: https://doc.traefik.io/traefik/reference/routing-configuration/kubernetes/ingress-nginx/ · provider config: https://doc.traefik.io/traefik/reference/install-configuration/providers/kubernetes/kubernetes-ingress-nginx/
- Migration: https://doc.traefik.io/traefik/migrate/nginx-to-traefik/ · https://github.com/traefik/ingress-nginx-migration · RKE2: https://docs.rke2.io/reference/ingress_migration · ingress-nginx EOL: https://kubernetes.io/blog/2025/11/11/ingress-nginx-retirement/
- EntryPoints (PROXY protocol, forwardedHeaders, timeouts): https://doc.traefik.io/traefik/reference/install-configuration/entrypoints/
- ServersTransport: https://doc.traefik.io/traefik/reference/routing-configuration/http/load-balancing/serverstransport/
- TLSStore default cert: https://doc.traefik.io/traefik/reference/routing-configuration/kubernetes/crd/tls/tlsstore/ · TLS overview: https://doc.traefik.io/traefik/reference/routing-configuration/http/tls/overview/
- WebSocket: https://doc.traefik.io/traefik/expose/overview/ · Buffering: https://doc.traefik.io/traefik/reference/routing-configuration/http/middlewares/buffering/ · RateLimit: https://doc.traefik.io/traefik/reference/routing-configuration/http/middlewares/ratelimit/
- Advisories: https://github.com/traefik/traefik/security/advisories/GHSA-fgjj-px3w-67xx · GHSA-62fc-8686-hfmq · GHSA-6765-c87h-8mrf
- Issues: #11820 (IngressClass ownership) · #11986 (HTTP/2 close) · #10962 (per-router timeout, open) · #12917 (RKE2+MetalLB dual-stack example) · #12897 (bare-metal status IPs, closed)
- Chart values: https://github.com/traefik/traefik-helm-chart/blob/master/traefik/values.yaml · CRDs: https://github.com/traefik/traefik-helm-chart/tree/master/traefik/crds
