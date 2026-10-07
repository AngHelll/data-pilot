# ADR 0003 — Diagnostic shape

- **Status:** Accepted (Phase 0 stub; plan §7 #12)  
- **Date:** 2026-10-07  

## Context

Parser, planner, runtime, and UI need a shared error/warning structure with optional source spans.

## Decision

```ts
interface Diagnostic {
  code: string;           // stable machine code, e.g. "unknown-column"
  severity: "error" | "warning" | "info" | "hint";
  message: string;        // human-readable, English for v0.1
  range?: { start: number; end: number }; // 0-based UTF-16 offsets
  path?: string;          // resource path when relevant
  related?: Array<{ message: string; path?: string }>;
}
```

- Codes for DQL are listed in `docs/DQL-SPEC.md` §9.  
- IPC failures carry a single `Diagnostic` in `error`.  
- Query results may include zero or more diagnostics without failing the whole job.

## Consequences

- UI can deep-link into the DQL bar when `range` is present.  
- Localization can key off `code` later without breaking IPC.
