# Data Pilot

VS Code extension + bundled engine for exploring test datasets (CSV/JSONL) without loading everything into memory.

Phase 0 delivers scaffolding, contracts/ADRs, a closed [DQL 0.1 spec](./docs/DQL-SPEC.md), and measured spikes (child process, streaming vs DuckDB candidate).

## Requirements

| Tool | Version |
|---|---|
| Node (Dev/CI) | **24 LTS** (also run tests on Node **22**) |
| VS Code (target) | **≥ 1.101** |
| npm | 10+ (workspaces) |

End users of the installed extension do **not** need a separate Node install — the engine child is launched with VS Code’s `process.execPath`.

## Quick start

```bash
git clone <repo-url> data-pilot
cd data-pilot
npm install
npm run build
npm test
```

### Spikes (Phase 0 evidence)

```bash
npm run spike:child-process   # startup / IPC / RSS / cancel / kill-recover
npm run spike:engine          # streaming preview on synthetic CSV + DuckDB packaging notes
```

Results write to [`docs/spikes/`](./docs/spikes/).

### Extension (local)

```bash
npm run extension:compile
# Open packages/extension in VS Code / Cursor and run “Extension: Development Host”
# or package a VSIX:
npm run extension:package     # → tmp/data-pilot.vsix
```

## Workspace layout

```text
packages/
  contracts/       Shared DTOs, IPC, Diagnostic, trust allowlists
  dql/             Spec stub (parser in Phase 2)
  core/            App services / trust gates
  engine-stream/   Streaming scanner (v0.1 default engine)
  runtime-node/    Child-process host + worker + spikes
  extension/       VS Code extension (engines.vscode ≥1.101, trust limited)
docs/
  DQL-SPEC.md      Closed DQL 0.1 specification
  adr/             Architecture decision records
  spikes/          Measured spike reports
```

## Trust

`untrustedWorkspaces.supported: "limited"` — open / metadata / preview / inspect only. Edit, export, global scans, and agents are blocked until the workspace is trusted.

## License notices

See [`NOTICE`](./NOTICE) and [`docs/adr/0005-license-notices.md`](./docs/adr/0005-license-notices.md). DuckDB remains a **candidate** (MIT); not bundled until packaging fits the ≤50 MiB/platform VSIX goal or a justified exception is recorded.

## Docs map

- [Product](./docs/PRODUCT.md)
- [Architecture](./docs/ARCHITECTURE.md)
- [DQL 0.1 spec](./docs/DQL-SPEC.md)
- [ADRs](./docs/adr/)
- [Spikes](./docs/spikes/)
