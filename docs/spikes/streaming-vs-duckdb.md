# Spike: streaming vs DuckDB (Phase 0)

**Measured:** 2026-10-07T08:54:12.644Z  
**Platform:** linux-x64  
**Node:** v24.21.0

## Streaming engine

### csv-1k (0.02 MiB)

| Op | Time | Notes |
|---|---:|---|
| preview (≤200 rows / ≤1 MiB) | 1.61 ms | rows=200, rss=144.59 MiB (Δ 0) |
| filter+take 50 | 0.67 ms | scanned=50 |
| count (full) | 0.51 ms | lines=1001 |
| count cancel | — | cancelled=false, lines=1001 |

### csv-100mb (100 MiB)

| Op | Time | Notes |
|---|---:|---|
| preview (≤200 rows / ≤1 MiB) | 0.48 ms | rows=200, rss=144.84 MiB (Δ 0.13) |
| filter+take 50 | 0.46 ms | scanned=246 |
| count (full) | 202.24 ms | lines=1339912 |
| count cancel | — | cancelled=true, lines=171108 |

## DuckDB candidate

- Available in workspace: **false**
- License: **MIT** (notices required if shipped)
- VSIX budget: **≤50 MiB / platform**

- DuckDB remains a candidate (D-002); streaming is the default path for v0.1.
- DuckDB and @duckdb/node-* clients are MIT — notices required if pulled in.
- Native binaries are per-platform; VSIX must use platform-specific packaging.
- @duckdb/node-api latest=1.5.6-r.1 license=MIT unpackedSize≈0.62 MiB (JS package only; native addon separate / platform-specific).
- Estimate (not installed here): DuckDB Node bindings + linux-x64 native often land in the tens of MiB per platform; risk of exceeding ≤50 MiB VSIX meta without careful packaging.
- Recommendation: keep streaming as v0.1 default; re-evaluate DuckDB in Phase 6 with a platform-specific VSIX size measurement before merging the dep.

## VSIX footprint

- Workspace walk: ~20.22 MiB (includes installed deps; not a packed VSIX)
- **Measured Phase 0 VSIX (streaming stub, `--no-dependencies`): ~8 KiB** — trivially under ≤50 MiB/platform
- Streaming-only estimate at v0.1 (with real CSV parser deps): still expected ≪ 50 MiB without natives
- With DuckDB: Likely to approach or exceed 50 MiB/platform once native binaries are included — must measure per-platform VSIX before adopting.

## Conclusions

- Streaming preview of ~100 MiB CSV stays memory-bounded (delta RSS small vs file size) because reads are incremental.
- filter+take can stop early without a full scan; count requires a full pass (cancel works cooperatively).
- DuckDB stays a candidate under MIT with license notices; packaging risk vs ≤50 MiB VSIX is the main open gate — do not hard-depend yet.
- v0.1 default engine: streaming. Analytics/DuckDB deferred until Phase 6 evidence + measured VSIX.

## Follow-ups

- Optional 1 GB fixture measurement on a machine with disk budget
- Real `@duckdb/node-api` (or chosen client) install + per-platform VSIX pack measurement before Phase 6
- Replace naive `split(',')` scanner with a proper CSV parser in Phase 1

Raw JSON: [streaming-vs-duckdb-results.json](./streaming-vs-duckdb-results.json)
