import type { DataValue, Diagnostic, KeyDiffResult, QueryBudget } from "@data-pilot/contracts";
import { cmpValues } from "./execute.js";
import type { DatasetStore } from "./session.js";

interface KeyRow {
  key: DataValue;
  cells: Map<string, DataValue>;
}

function empty(diagnostics: Diagnostic[], completion: KeyDiffResult["completion"]): KeyDiffResult {
  return { completion, diagnostics, onlyLeft: [], onlyRight: [], changed: [] };
}

function same(a: DataValue, b: DataValue): boolean {
  return cmpValues("=", a, b) === true;
}

async function readSide(
  store: DatasetStore,
  datasetId: string,
  column: string,
  header: string[],
  budget: QueryBudget,
): Promise<{ rows: KeyRow[]; truncated: boolean; duplicate: boolean }> {
  const rows: KeyRow[] = [];
  let scannedBytes = 0;
  let truncated = false;
  let duplicate = false;
  for await (const row of store.iterate(datasetId, undefined, (n) => {
    scannedBytes += n;
  })) {
    if (budget.maxScanBytes !== undefined && scannedBytes > budget.maxScanBytes) {
      truncated = true;
      break;
    }
    const cells = new Map<string, DataValue>();
    header.forEach((name, i) => {
      cells.set(name, row.values[i] ?? { kind: "missing" });
    });
    const key = cells.get(column) ?? { kind: "missing" };
    if (key.kind === "null" || key.kind === "missing") continue;
    if (!duplicate && rows.some((prev) => same(prev.key, key))) duplicate = true;
    rows.push({ key, cells });
  }
  return { rows, truncated, duplicate };
}

function changedColumns(
  leftHeader: string[],
  rightHeader: string[],
  left: Map<string, DataValue>,
  right: Map<string, DataValue>,
  keyColumn: string,
): string[] {
  const names = [...leftHeader, ...rightHeader.filter((name) => !leftHeader.includes(name))];
  const out: string[] = [];
  for (const name of names) {
    if (name === keyColumn) continue;
    const inLeft = leftHeader.includes(name);
    const inRight = rightHeader.includes(name);
    if (!inLeft || !inRight) {
      out.push(name);
      continue;
    }
    const a = left.get(name) ?? { kind: "missing" as const };
    const b = right.get(name) ?? { kind: "missing" as const };
    if (!same(a, b)) out.push(name);
  }
  return out;
}

/** Compare two already-open datasets by a user-named key. Does not open or write paths. */
export async function compareByKey(
  store: DatasetStore,
  leftId: string,
  rightId: string,
  column: string,
  budget: QueryBudget = {},
): Promise<KeyDiffResult> {
  const leftHeader = store.describe(leftId).handle.columns.map((c) => c.name);
  const rightHeader = store.describe(rightId).handle.columns.map((c) => c.name);
  if (!leftHeader.includes(column) || !rightHeader.includes(column)) {
    return empty(
      [
        {
          code: "unknown-column",
          severity: "error",
          message: `Unknown column '${column}'`,
        },
      ],
      "error",
    );
  }

  const left = await readSide(store, leftId, column, leftHeader, budget);
  const right = await readSide(store, rightId, column, rightHeader, budget);
  if (left.truncated || right.truncated) {
    return empty(
      [
        {
          code: "compare-failed",
          severity: "error",
          message: "compare is not exact because the scan did not finish",
        },
      ],
      "error",
    );
  }
  if (left.duplicate || right.duplicate) {
    return empty(
      [
        {
          code: "compare-failed",
          severity: "error",
          message: "compare failed: repeated concrete key",
        },
      ],
      "error",
    );
  }

  const used = new Set<number>();
  const onlyLeft: DataValue[] = [];
  const changed: KeyDiffResult["changed"] = [];
  for (const row of left.rows) {
    const idx = right.rows.findIndex((other, i) => !used.has(i) && same(row.key, other.key));
    if (idx < 0) {
      onlyLeft.push(row.key);
      continue;
    }
    used.add(idx);
    const columns = changedColumns(
      leftHeader,
      rightHeader,
      row.cells,
      right.rows[idx]!.cells,
      column,
    );
    if (columns.length > 0) changed.push({ key: row.key, columns });
  }
  const onlyRight = right.rows.filter((_, i) => !used.has(i)).map((row) => row.key);
  return { completion: "complete", diagnostics: [], onlyLeft, onlyRight, changed };
}
