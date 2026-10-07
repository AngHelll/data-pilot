# Data Pilot

Extensión VS Code + motor empaquetado para explorar datasets de prueba (CSV/JSONL) **sin cargar todo en memoria**. Proyecto independiente; plan y ADRs en `docs/`.

| Fase | Estado |
|------|--------|
| 0 | Scaffolding, ADRs, [DQL 0.1 spec](./docs/DQL-SPEC.md), spikes |
| 1–2 | Preview CSV/JSONL + DQL 0.1 headless (motor streaming + IPC proceso hijo) |
| 3+ | UI VS Code, edición fixtures, VSIX piloto |

**Checkout local recomendado (Mac):** `~/workspace/repos/data-pilot` — ver [SETUP-MAC.md](./docs/SETUP-MAC.md) si clonaste una carpeta `tmp-…` de Cursor.

## Requirements

| Tool | Version |
|---|---|
| Node (Dev/CI) | **24 LTS** (also run tests on Node **22**) |
| VS Code (target) | **≥ 1.101** |
| npm | 10+ (workspaces) |

End users of the installed extension do **not** need a separate Node install — the engine child is launched with VS Code’s `process.execPath`.

## Quick start

```bash
# Cuando exista GitHub (p. ej. AngHelll/data-pilot):
git clone git@github.com:AngHelll/data-pilot.git ~/workspace/repos/data-pilot
cd ~/workspace/repos/data-pilot
npm install && npm run build && npm test
```

Si ya tienes un clone en `~/tmp-23fca949cfc9bbb8`, sigue [docs/SETUP-MAC.md](./docs/SETUP-MAC.md) para moverlo.

### Preview a dataset (Phase 1)

```bash
npm run preview -- fixtures/sample/tiny.csv
npm run preview -- fixtures/sample/people.jsonl
npm run describe -- fixtures/sample/tiny.csv
```

Preview returns metadata (suggested column types), parse warnings, and a bounded row sample (default ≤200 rows / ≤1 MiB). Opening a file does **not** count or load the whole dataset.

### Run DQL 0.1 headless (Phase 2)

```bash
npm run query -- fixtures/sample/tiny.csv 'where country = "MX" and balance > 50000 | select id, name | take 10'

npm run query -- fixtures/sample/tiny.csv 'where country = $c | count' --param c=MX

npm run query -- fixtures/sample/people.jsonl 'find "Ada" | take 5'
```

Supported (DQL 0.1): predicates, `find`, params, `select`, `take`, `count`.  
Deferred: `sort`, grouping, `duplicates`, `expect`.

### Spikes (Phase 0 evidence)

```bash
npm run spike:child-process
npm run spike:engine
```

Results: [`docs/spikes/`](./docs/spikes/).

### Extension (local)

```bash
npm run extension:compile
# Open packages/extension in VS Code / Cursor → “Extension: Development Host”
npm run extension:package     # → tmp/data-pilot.vsix
```

## Workspace layout

```text
packages/
  contracts/       DTOs, IPC, Diagnostic, trust allowlists
  dql/             DQL 0.1 tokenizer / parser / typecheck / formatter
  core/            Dataset + query services, trust gates, CLI
  engine-stream/   CSV/JSONL ingest, preview sessions, streaming executor
  runtime-node/    Child-process host + worker (IPC)
  extension/       VS Code extension (engines.vscode ≥1.101, trust limited)
docs/
  DQL-SPEC.md      Closed DQL 0.1 specification
  adr/             Architecture decision records
  spikes/          Measured spike reports
fixtures/sample/   Tiny CSV/JSONL examples
```

## Trust (D-005)

`untrustedWorkspaces.supported: "limited"` — open / metadata / preview / inspect only.  
`executeQuery`, edit, export, global scans, and agents are blocked in untrusted mode (enforced in core handlers and the engine worker).

## License notices

See [`NOTICE`](./NOTICE). Bundled `csv-parse` is MIT. DuckDB remains a **candidate** (MIT); not bundled yet.

## Docs map

- [Product](./docs/PRODUCT.md)
- [Architecture](./docs/ARCHITECTURE.md)
- [DQL 0.1 spec](./docs/DQL-SPEC.md)
- [ADRs](./docs/adr/)
- [Spikes](./docs/spikes/)
