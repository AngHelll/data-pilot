# Spike: DuckDB VSIX size (Phase 6)

**Measured:** 2026-10-07T20:55:03.325Z
**Platform:** darwin-arm64
**Package:** `@duckdb/node-api@1.5.6-r.1`
**License:** MIT
**Budget:** ≤50 MiB per platform (D-002)

This install lived in `tmp/duckdb-vsix-measure` and is not a workspace dependency.

## This platform

| Artifact | Bytes | MiB |
|---|---:|---:|
| Throwaway VSIX (native included) | 36183110 | 34.51 |
| Product VSIX | 66872 | 0.06 |

Product VSIX `tmp/data-pilot.vsix`: **66872 bytes** (0.06 MiB). Packaged with `--no-dependencies`; it does not include DuckDB.

The throwaway VSIX is 34.51 MiB, under the 50 MiB cap on this platform. This phase still does not adopt DuckDB. Streaming stays the default engine.

Notices: DuckDB is MIT. `NOTICE` still says it is not bundled. A full MIT notice is required only if a later spec ships the binary.

## Platforms

| Target | Status | Bytes | MiB |
|---|---|---:|---:|
| darwin-arm64 | measured | 36183110 | 34.51 |
| darwin-x64 | not measured |  |  |
| linux-arm64 | not measured |  |  |
| linux-x64 | not measured |  |  |
| win32-arm64 | not measured |  |  |
| win32-x64 | not measured |  |  |
| alpine-arm64 | not measured |  |  |
| alpine-x64 | not measured |  |  |

Phase 0 estimates in `streaming-vs-duckdb.md` are not measurements for the rows above.

## Native entries in the throwaway VSIX

```
517864  10-07-2026 14:55   extension/node_modules/@duckdb/node-bindings-darwin-arm64/duckdb.node
117008720  10-07-2026 14:55   extension/node_modules/@duckdb/node-bindings-darwin-arm64/libduckdb.dylib
```
