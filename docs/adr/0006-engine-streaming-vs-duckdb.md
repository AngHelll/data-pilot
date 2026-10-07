# ADR 0006 — Streaming default; DuckDB candidate

- **Status:** Accepted for v0.1 direction (revisit Phase 6)  
- **Date:** 2026-10-07  

## Context

v0.1 needs bounded-memory preview/filter/take/count on CSV/JSONL. DuckDB could accelerate analytics but adds native binaries and VSIX size risk (goal ≤50 MiB/platform).

## Decision

- **Default engine for v0.1:** `@data-pilot/engine-stream`.  
- **DuckDB:** remains a candidate; not a hard dependency until a measured per-platform VSIX and RSS comparison justifies it.  
- Exceeding the 50 MiB VSIX meta requires written justification (D-002).

## Evidence

[../spikes/streaming-vs-duckdb.md](../spikes/streaming-vs-duckdb.md)

## Consequences

- Phase 1–2 invest in a correct streaming CSV/JSONL path.  
- Phase 6 re-opens analytics with packaging proof.  
- Phase 6 measured a throwaway VSIX with `@duckdb/node-api@1.5.6-r.1` on darwin-arm64 at 34.51 MiB (under the 50 MiB cap). See [../spikes/phase6-duckdb-vsix.md](../spikes/phase6-duckdb-vsix.md). Other platforms were not measured. Streaming stays the default engine. DuckDB is not a dependency of the extension.
