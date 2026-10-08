# Data Pilot — Base design (repo copy)

This file anchors implementation to the product architecture roadmap.

- **Authoritative plan (Context):** project store `docs/data-pilot-plan.md`  
- **Closed decisions:** `docs/decisions.md` (D-001…D-006)  
- **In-repo living docs:** [PRODUCT.md](./PRODUCT.md), [ARCHITECTURE.md](./ARCHITECTURE.md), [UX-TARGET.md](./UX-TARGET.md), [DQL-SPEC.md](./DQL-SPEC.md), [adr/](./adr/)

## Locked decisions (do not reopen without Ángel)

| ID | Decision |
|---|---|
| D-001 | Child-process isolation first; spike validates; no dual runtime |
| D-002 | DuckDB candidate; MIT notices; VSIX ≤50 MiB/platform meta |
| D-003 | VS Code ≥1.101; Node 22 runtime; Dev/CI Node 24 + Node 22 tests |
| D-004 | DQL 0.1 scope approved; **spec closed before parser** |
| D-005 | Untrusted = limited read-only preview + enforce |
| D-006 | Independent repo; init from real directory state |

## Implementation rule

One phase per turn. Phase 0 gate must pass before Phase 1 ingest work.

Phases 0–6 did not implement the phase 7 layout ([UX-TARGET.md](./UX-TARGET.md)). They kept the `where` stage, the Explorer v0.1 path, host-written edits, and a single child process so phase 7 could relocate those capabilities without a second dialect or a second engine. The current surface is phase 7 (specs 1–13).
