# ADR 0001 — Child-process runtime isolation

- **Status:** Accepted (D-001)  
- **Date:** 2026-10-07  

## Context

The engine may scan large files and (later) load native analytics code. Running that work on the VS Code extension host risks UI freezes, memory pressure, and unrecoverable native crashes.

## Decision

Use a **Node child process** as the initial isolation boundary:

- Spawn with `process.execPath` so end users need no separate Node install.  
- Communicate via newline-delimited JSON IPC (`protocolVersion`, `requestId`).  
- Cooperative cancel through `cancelJob`; **SIGKILL + restart** on excess RSS or abrupt/native failure.  
- Do **not** build a second full runtime (worker threads) unless a later spike shows clear benefits.

## Consequences

- Startup/IPC overhead must stay acceptable for interactive preview (measured in Phase 0 spike).  
- Worker entry is packaged beside the extension (`out/engine-worker.js`), not loaded from the workspace.  
- Host owns lifecycle: start, cancel, kill, recover.

## Evidence

See [../spikes/child-process.md](../spikes/child-process.md).
