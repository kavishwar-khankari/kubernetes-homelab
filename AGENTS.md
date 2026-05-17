# AGENTS.md

Read `CLAUDE.md` — it has all conventions and patterns.

## Watch for

- Domain: `*.techtronics.top`
- Ingress: omit `tls.secretName` (nginx-ingress uses default wildcard cert)
- RWO volumes + Deployment: `strategy: Recreate` (RollingUpdate deadlocks)
- Multi-container pods: co-locate tightly-coupled containers (shared networking)
- DopplerSecret: lives in `doppler-operator-system` namespace; `managedSecret` goes to target namespace
- Storage: Longhorn PVC (RWO), SMB CSI static PV+PVC (RWX), hostPath (with `mountPropagation: HostToContainer`), StatefulSet `volumeClaimTemplates`

## Two deployment patterns

**In-cluster**: `manifests/<app>/` + `argo-apps/<app>.yaml` (ref: jellyfin)
**Reverse-proxy**: `reverse-proxy/<app>/` — auto-discovered, no per-app ArgoCD yaml needed

## Bootstrap

`argo-master-app/master-app.yaml` → syncs `argo-apps/` → syncs everything. Push to deploy.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- ALWAYS read graphify-out/GRAPH_REPORT.md before reading any source files, running grep/glob searches, or answering codebase questions. The graph is your primary map of the codebase.
- IF graphify-out/wiki/index.md EXISTS, navigate it instead of reading raw files
- For cross-module "how does X relate to Y" questions, prefer `graphify query "<question>"`, `graphify path "<A>" "<B>"`, or `graphify explain "<concept>"` over grep — these traverse the graph's EXTRACTED + INFERRED edges instead of scanning files
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

## Web search

Always delegate web searches to the `websearch` subagent via the Task tool. Example: "search the web for X and return the results". The `websearch` subagent uses the cheap `deepseek/deepseek-v4-flash` model and only has SearXNG MCP tools — this avoids the $0.02/query OpenRouter built-in search cost. Never use the built-in `WebSearch` or `WebFetch` tools directly.

## Reading Reddit threads

The new Reddit UI (`www.reddit.com`) blocks direct fetch with a verification wall. Use either of these instead:
- **JSON API**: append `.json` to the URL (e.g. `https://www.reddit.com/r/subreddit/comments/.../.json`) — use `webfetch` with `format: text`.
- **Old Reddit**: replace `www.reddit.com` with `old.reddit.com` — use `webfetch` with `format: markdown`.
