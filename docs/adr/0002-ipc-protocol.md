# ADR 0002 — IPC protocol shape

- **Status:** Accepted (Phase 0 stub; implementer-defined per plan §7 #12)  
- **Date:** 2026-10-07  

## Context

Extension host and engine child need a versioned, multiplexed request/response channel. Stale responses from cancelled jobs must not update UI state.

## Decision

**Transport:** newline-delimited JSON over stdin/stdout. stderr reserved for lifecycle events (`ready`, `rss-limit-exceeded`) and diagnostics that are not request-scoped.

**Request:**

```ts
{
  protocolVersion: 1,
  requestId: string,
  op: EngineOp,
  payload?: unknown
}
```

**Response:**

```ts
{ protocolVersion: 1, requestId, ok: true, result: unknown }
// or
{ protocolVersion: 1, requestId, ok: false, error: Diagnostic }
```

- Mismatched `protocolVersion` → error `protocol-version-mismatch`.  
- Host discards responses whose `requestId` is not in the pending map (`isStaleResponse`).  
- Ops and trust allowlists live in `@data-pilot/contracts`.

## Consequences

- Simple to debug and language-agnostic for a future non-Node engine.  
- Not suitable for bulk row streaming without chunking — page via `fetchPage` / budgets.  
- Binary payloads out of scope for v0.1.

## Types

Canonical TypeScript definitions: `packages/contracts/src/index.ts`.
