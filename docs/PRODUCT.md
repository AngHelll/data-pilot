# Data Pilot — Product

**Status:** Phase 0 foundation  
**Author:** Ángel Jiménez Ríos  
**Plan:** Context `docs/data-pilot-plan.md` (project store) · decisions D-001…D-006

## What it is

Data Pilot helps humans, automations, and agents **find, understand, modify, and consume test data** without knowing or loading an entire dataset. No LLM required.

## First installable surface

VS Code extension (VSIX). Engine and DQL are independent of VS Code so CLI / CI / agent adapters can follow in v0.2+.

## Human flow for v0.1

1. Open a dataset (CSV/JSONL) → metadata + bounded preview  
2. See suggested types and parse warnings  
3. Filter via UI or DQL (`country = "MX"`, `balance > 50000`)  
4. Inspect candidates, save query, export a subset  
5. Open the exported fixture, edit values, review diff before save  

## Non‑negotiables

- Human-first **and** agent-ready contracts  
- Bounded memory — open ≠ read everything  
- Facts, inferences, and rules kept separate  
- Queries never mutate the source; writes are explicit  
- Honest cost (result limits ≠ scan cost)  
- Local by default  

## Trust (D-005)

Untrusted workspaces: **limited** read-only preview (explicit open, metadata, preview, inspect). Block edit, export, global scans, agents. Parser/runtime are bundled — never load code from the workspace.

## Version floors (D-003)

- VS Code **≥ 1.101**  
- Runtime compatible with **Node 22** (host)  
- Dev/CI: **Node 24 LTS** + Node 22 compat tests  

## Out of scope for v0.1

Full 50 GB support, business-rule inference, VS Code web, joins, .NET SDK, inventing confidence percentages.
