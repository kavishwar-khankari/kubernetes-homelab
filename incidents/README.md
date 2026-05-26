# Incidents

Quick-reference tracker. Each incident has a dedicated file in this directory.

## Index

| # | Date | Title | Severity | Node(s) | Root Cause | Status |
|---|------|-------|----------|---------|------------|--------|
| [1](./001-longhorn-mount-failures.md) | 2026-05-09 | Longhorn mount failures (exit 32) | High | k3s-node-3 | multipathd hijacking iSCSI + engine-image OOM | Resolved |
| [2](./002-loki-chunks-cache-memory-overprovisioning.md) | 2026-05-27 | Loki chunks cache memory overprovisioning | Medium | k3s-node-1 | Loki chart defaults (8Gi cache, no TTL) | Resolved |
