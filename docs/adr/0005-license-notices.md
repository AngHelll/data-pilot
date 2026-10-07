# ADR 0005 — License and notices for dependencies

- **Status:** Accepted (D-002)  
- **Date:** 2026-10-07  

## Context

Shipping a VSIX bundles third-party code. DuckDB and the Neo client are MIT and remain candidates; notices must ship if they (or other deps) are included.

## Decision

- Maintain root [`NOTICE`](../../NOTICE) and keep license texts for bundled dependencies.  
- Prefer MIT/BSD/Apache-2.0 dependencies; flag copyleft for explicit review before add.  
- If DuckDB (or any native addon) is adopted:  
  - include MIT license texts in NOTICE / `ThirdPartyNotices.txt` inside the VSIX  
  - document per-platform binary provenance  
- CI SHOULD eventually fail packaging when NOTICE is stale (follow-up); Phase 0 seeds the file and process.

## Consequences

- Adding a dependency is a docs+legal checklist item, not only a `package.json` change.  
- Spike docs record MIT status for DuckDB without installing it yet.
