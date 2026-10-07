# ADR 0004 — Untrusted workspace limited mode

- **Status:** Accepted (D-005)  
- **Date:** 2026-10-07  

## Context

VS Code Workspace Trust must not be bypassed. Opening arbitrary CSV/JSONL still needs a useful preview without enabling write/export/agent paths.

## Decision

Declare in the extension manifest:

```json
"capabilities": {
  "untrustedWorkspaces": {
    "supported": "limited",
    "description": "…",
    "restrictedConfigurations": ["dataPilot.allowExport", "dataPilot.allowEdit"]
  }
}
```

**Allowed (untrusted):** `openDataset`, `describeDataset`, `preview`, `fetchPage`, `inspectValue`, `cancelJob`, `closeDataset`.  

**Blocked:** `exportResult`, `editFixture`, `saveQuery`, `globalScan`, `agentQuery`, and (initially) `executeQuery` / arbitrary DQL execution until a tighter allowlist exists.

Enforcement points:

1. Extension command/handlers (`assertOpAllowed` in `@data-pilot/core`)  
2. Engine worker (`DATA_PILOT_TRUST_MODE=untrusted-limited`)  

Parser and runtime are **bundled only** — never `require`/`import` from the workspace.

## Consequences

- Untrusted users get orientation preview; full v0.1 flow requires trust.  
- Dual enforcement avoids a compromised webview/host path escalating privileges.
