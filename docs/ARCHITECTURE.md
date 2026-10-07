# Data Pilot — Architecture

## Overview

```text
Extensión VS Code ─┐
CLI / agent later ─┼→ Application services (core) → DQL (parser/types/plan)
                   │                                   ↓
                   │                              Runtime (child process)
                   │                              ├─ engine-stream (default v0.1)
                   │                              └─ engine-analytics (optional later)
                   └──────────────────────────→ Datasets & revisions
```

## Packages (npm workspaces)

| Package | Role | Forbidden |
|---|---|---|
| `@data-pilot/contracts` | DTOs, IPC, Diagnostic, budgets, trust ops | VS Code, UI, natives |
| `@data-pilot/dql` | Spec-aligned parser (Phase 2+) | Filesystem, VS Code |
| `@data-pilot/core` | Sessions, trust gates, app services | VS Code, React |
| `@data-pilot/engine-stream` | CSV/JSONL scans, predicates, select/take | UI |
| `@data-pilot/runtime-node` | Child process host, IPC, limits, kill/recover | Webview |
| `@data-pilot/extension` | Commands, trust declaration, editor (later) | Business logic duplication; workspace deps |

## Runtime isolation (D-001)

- **Initial path:** Node child process spawned with `process.execPath` (Electron/VS Code Node — no separate Node install for users).  
- **IPC:** newline-delimited JSON; `protocolVersion` + `requestId`; stale responses discarded.  
- **Limits:** cooperative cancel via `cancelJob`; host may `SIGKILL` and recover on excess RSS or native/abrupt failure.  
- **Workers:** only if a later spike shows clear advantage; do not maintain two full runtimes.

See [adr/0001-child-process-isolation.md](./adr/0001-child-process-isolation.md) and [spikes/child-process.md](./spikes/child-process.md).

## Engine strategy (D-002)

- **v0.1 default:** streaming (`engine-stream`).  
- **DuckDB:** remains a candidate (MIT + notices); adopt only with measured VSIX ≤50 MiB/platform or justified exception.  
- Native binaries → platform-specific packaging.

See [spikes/streaming-vs-duckdb.md](./spikes/streaming-vs-duckdb.md).

## Contracts

- Dataset identity by **revision** (size/mtime; `contentHash` optional).  
- Tagged `DataValue` — integers/decimals as strings (no JS Number precision loss).  
- `QueryBudget` / `QueryResult` with honest `completion` and scan cost fields.  
- `Diagnostic` shape shared across parser, planner, runtime.  

Definitions live in `@data-pilot/contracts`.

## Security

- CSP + validated webview messages (Phase 3).  
- Values rendered as text, never HTML.  
- Paths authorized by the host.  
- Logs without row payloads/secrets.  
- `untrustedWorkspaces.supported: "limited"` enforced in handlers ([adr/0004-untrusted-limited.md](./adr/0004-untrusted-limited.md)).

## Floors

- `engines.vscode`: `^1.101.0`  
- Runtime: Node 22 compatible  
- Dev/CI: Node 24 LTS + Node 22 matrix  

## Phase map

| Phase | Focus |
|---|---|
| 0 | Foundation, ADRs, DQL spec, spikes (this doc set) |
| 1 | CSV/JSONL ingest + preview |
| 2 | DQL 0.1 parser + streaming engine |
| 3 | VS Code workspace UI |
| 4 | Safe fixture edit |
| 5 | v0.1 close / human eval |
| 6+ | Analytics, expect/diff, CLI/agents |
