import {
  type ColumnMeta,
  type DataValue,
  type Diagnostic,
  type QueryBudget,
  type QueryResult,
  integerValue,
  isConcrete,
  valueToSearchText,
} from "@data-pilot/contracts";
import type { DqlQuery, Expr, Predicate, Stage } from "@data-pilot/dql";
import { classifySample } from "./cell.js";
import type { DatasetStore } from "./session.js";

type Tri = true | false | "unknown";

function and3(a: Tri, b: Tri): Tri {
  if (a === false || b === false) return false;
  if (a === "unknown" || b === "unknown") return "unknown";
  return true;
}

function or3(a: Tri, b: Tri): Tri {
  if (a === true || b === true) return true;
  if (a === "unknown" || b === "unknown") return "unknown";
  return false;
}

function not3(a: Tri): Tri {
  if (a === "unknown") return "unknown";
  return !a;
}

function compareNumeric(a: string, b: string): number {
  if (/^-?\d+$/.test(a) && /^-?\d+$/.test(b)) {
    const bi = BigInt(a) - BigInt(b);
    return bi === 0n ? 0 : bi < 0n ? -1 : 1;
  }
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) {
    return na === nb ? 0 : na < nb ? -1 : 1;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

function cmpValues(op: string, left: DataValue, right: DataValue): Tri {
  if (left.kind === "null" || left.kind === "missing" || right.kind === "null" || right.kind === "missing") {
    return "unknown";
  }
  if (
    (left.kind === "integer" || left.kind === "decimal") &&
    (right.kind === "integer" || right.kind === "decimal")
  ) {
    const c = compareNumeric(left.value, right.value);
    switch (op) {
      case "=":
        return c === 0;
      case "!=":
        return c !== 0;
      case "<":
        return c < 0;
      case "<=":
        return c <= 0;
      case ">":
        return c > 0;
      case ">=":
        return c >= 0;
    }
  }
  if (left.kind === "string" && right.kind === "string") {
    const c = left.value < right.value ? -1 : left.value > right.value ? 1 : 0;
    switch (op) {
      case "=":
        return c === 0;
      case "!=":
        return c !== 0;
      case "<":
        return c < 0;
      case "<=":
        return c <= 0;
      case ">":
        return c > 0;
      case ">=":
        return c >= 0;
    }
  }
  if (left.kind === "boolean" && right.kind === "boolean") {
    switch (op) {
      case "=":
        return left.value === right.value;
      case "!=":
        return left.value !== right.value;
      default:
        return "unknown";
    }
  }
  if (
    (left.kind === "date" || left.kind === "datetime" || left.kind === "string") &&
    (right.kind === "date" || right.kind === "datetime" || right.kind === "string")
  ) {
    const lv = "value" in left ? String(left.value) : "";
    const rv = "value" in right ? String(right.value) : "";
    const c = lv < rv ? -1 : lv > rv ? 1 : 0;
    switch (op) {
      case "=":
        return c === 0;
      case "!=":
        return c !== 0;
      case "<":
        return c < 0;
      case "<=":
        return c <= 0;
      case ">":
        return c > 0;
      case ">=":
        return c >= 0;
    }
  }
  // mixed/unknown pairings → unknown (no silent coerce)
  return "unknown";
}

function resolveExpr(
  expr: Expr,
  row: Map<string, DataValue>,
  params: Record<string, DataValue>,
): DataValue {
  switch (expr.kind) {
    case "column":
      return row.get(expr.name) ?? { kind: "missing" };
    case "string":
      return { kind: "string", value: expr.value };
    case "integer":
      return { kind: "integer", value: expr.value };
    case "decimal":
      return { kind: "decimal", value: expr.value };
    case "boolean":
      return { kind: "boolean", value: expr.value };
    case "null":
      return { kind: "null" };
    case "missing":
      return { kind: "missing" };
    case "param":
      return params[expr.name] ?? { kind: "missing" };
    case "date": {
      const inner = resolveExpr(expr.arg, row, params);
      if (inner.kind === "string" || inner.kind === "date" || inner.kind === "datetime") {
        return { kind: "date", value: inner.value };
      }
      return { kind: "null" };
    }
  }
}

function evalPred(
  pred: Predicate,
  row: Map<string, DataValue>,
  params: Record<string, DataValue>,
): Tri {
  switch (pred.kind) {
    case "and":
      return and3(evalPred(pred.left, row, params), evalPred(pred.right, row, params));
    case "or":
      return or3(evalPred(pred.left, row, params), evalPred(pred.right, row, params));
    case "not":
      return not3(evalPred(pred.inner, row, params));
    case "cmp":
      return cmpValues(
        pred.op,
        resolveExpr(pred.left, row, params),
        resolveExpr(pred.right, row, params),
      );
    case "is": {
      const v = resolveExpr(pred.expr, row, params);
      if (pred.test === "null") {
        // `is not null` is true only for concrete values (missing ⇒ false).
        return pred.negated ? isConcrete(v) : v.kind === "null";
      }
      if (pred.test === "missing") {
        return pred.negated ? v.kind !== "missing" : v.kind === "missing";
      }
      // empty: string length 0 or null (not missing)
      const empty =
        v.kind === "null" || (v.kind === "string" && v.value.length === 0);
      return pred.negated ? isConcrete(v) && !(v.kind === "string" && v.value.length === 0) : empty;
    }
    case "contains": {
      const v = resolveExpr(pred.expr, row, params);
      if (v.kind === "null" || v.kind === "missing") return "unknown";
      const text = valueToSearchText(v);
      if (text === null) return "unknown";
      return text.includes(pred.needle);
    }
    case "in": {
      const v = resolveExpr(pred.expr, row, params);
      if (v.kind === "null" || v.kind === "missing") return "unknown";
      let anyUnknown = false;
      for (const lit of pred.values) {
        const r = cmpValues("=", v, resolveExpr(lit, row, params));
        if (r === true) return true;
        if (r === "unknown") anyUnknown = true;
      }
      return anyUnknown ? "unknown" : false;
    }
  }
}

function rowMap(
  columns: string[],
  values: DataValue[],
  raw: string[],
  metas: ColumnMeta[],
): Map<string, DataValue> {
  const map = new Map<string, DataValue>();
  for (let i = 0; i < columns.length; i++) {
    let v = values[i] ?? { kind: "missing" };
    const meta = metas[i];
    if (v.kind === "string" && meta && meta.inferredType !== "string" && meta.inferredType !== "mixed" && meta.inferredType !== "unknown") {
      const c = classifySample(raw[i] ?? "");
      if (c.kind === meta.inferredType || (meta.inferredType === "decimal" && c.kind === "integer")) {
        v = c;
      }
    }
    map.set(columns[i]!, v);
  }
  return map;
}

function matchFind(
  stage: Extract<Stage, { kind: "find" }>,
  map: Map<string, DataValue>,
): boolean {
  const cols = stage.columns ?? [...map.keys()];
  const needle =
    stage.caseMode === "insensitive" ? stage.needle.toLocaleLowerCase() : stage.needle;
  for (const col of cols) {
    const v = map.get(col);
    if (!v || !isConcrete(v)) continue;
    let text = valueToSearchText(v);
    if (text === null) continue;
    if (stage.caseMode === "insensitive") text = text.toLocaleLowerCase();
    if (text.includes(needle)) return true;
  }
  return false;
}

export async function executeDql(
  store: DatasetStore,
  datasetId: string,
  query: DqlQuery,
  params: Record<string, DataValue>,
  budget: QueryBudget,
  requestId: string,
  signal?: AbortSignal,
): Promise<QueryResult> {
  const stale = await store.assertFresh(datasetId);
  const session = store.get(datasetId);
  const diagnostics: Diagnostic[] = [...session.diagnostics];
  if (stale) {
    return {
      requestId,
      datasetId,
      revisionId: session.handle.revision.revisionId,
      columns: session.header,
      rows: [],
      rowCountReturned: 0,
      completion: "error",
      scope: "unknown",
      diagnostics: [stale],
    };
  }

  const findStage = query.stages.find((s) => s.kind === "find") as
    | Extract<Stage, { kind: "find" }>
    | undefined;
  const whereStages = query.stages.filter((s) => s.kind === "where") as Extract<
    Stage,
    { kind: "where" }
  >[];
  const selectStage = query.stages.find((s) => s.kind === "select") as
    | Extract<Stage, { kind: "select" }>
    | undefined;
  const takeStage = query.stages.find((s) => s.kind === "take") as
    | Extract<Stage, { kind: "take" }>
    | undefined;
  const countStage = query.stages.find((s) => s.kind === "count");

  const outColumns = selectStage?.columns ?? session.header;
  // Without take/count, cap returned rows so open-ended queries stay bounded.
  const maxRows =
    takeStage?.count ??
    (countStage ? undefined : (budget.maxRows ?? 200));
  const maxScanBytes = budget.maxScanBytes;
  const wallClockMs = budget.wallClockMs;
  const started = Date.now();

  const outRows: DataValue[][] = [];
  let matchCount = 0;
  let scannedRows = 0;
  let scannedBytes = 0;
  let truncated = false;
  let cancelled = false;

  for await (const row of store.iterate(datasetId, signal, (n) => {
    scannedBytes += n;
  })) {
    if (signal?.aborted) {
      cancelled = true;
      break;
    }
    if (wallClockMs !== undefined && Date.now() - started > wallClockMs) {
      truncated = true;
      break;
    }
    if (maxScanBytes !== undefined && scannedBytes > maxScanBytes) {
      truncated = true;
      break;
    }

    scannedRows += 1;
    const map = rowMap(session.header, row.values, row.raw, session.handle.columns);

    if (findStage && !matchFind(findStage, map)) continue;

    let ok = true;
    for (const w of whereStages) {
      if (evalPred(w.predicate, map, params) !== true) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;

    matchCount += 1;

    if (countStage) continue;

    if (maxRows !== undefined && outRows.length >= maxRows) {
      // Still need to know if more matches exist for completion honesty when take is set —
      // with take, completion is complete if we finish the file; truncated only on budget.
      if (takeStage) {
        // keep scanning only if we need count? For take, we can stop early.
        truncated = false;
        // Early stop on take — file may have more; completion is truncated unless we prove exhaustion.
        // Spec: take can stop; completion complete only if upstream finished.
        // Early exit ⇒ truncated/prefix.
        truncated = true;
        break;
      }
      truncated = true;
      break;
    }

    outRows.push(outColumns.map((c) => map.get(c) ?? { kind: "missing" }));
  }

  if (signal?.aborted) cancelled = true;

  // If we exhausted the iterator without early break, not truncated.
  const exhausted = !truncated && !cancelled;

  if (countStage) {
    const completion = cancelled ? "cancelled" : truncated ? "truncated" : "complete";
    return {
      requestId,
      datasetId,
      revisionId: session.handle.revision.revisionId,
      columns: ["count"],
      rows: completion === "complete" ? [[integerValue(String(matchCount))]] : [],
      rowCountReturned: completion === "complete" ? 1 : 0,
      ...(completion === "complete" ? { totalCount: matchCount } : {}),
      completion,
      scope: completion === "complete" ? "full" : "prefix",
      diagnostics,
      scannedBytes,
      scannedRows,
    };
  }

  // take early-stop: if we stopped because take filled, mark truncated unless exhausted
  let completion: QueryResult["completion"] = "complete";
  if (cancelled) completion = "cancelled";
  else if (truncated) completion = "truncated";
  else if (exhausted) completion = "complete";

  // Fix take early-stop: when take fills and we break, we set truncated=true.
  // If take exactly filled and we broke, completion should be truncated (prefix) — honest.
  // If file ended with fewer rows, truncated stays false.

  return {
    requestId,
    datasetId,
    revisionId: session.handle.revision.revisionId,
    columns: outColumns,
    rows: outRows,
    rowCountReturned: outRows.length,
    completion,
    scope: completion === "complete" ? "full" : "prefix",
    diagnostics,
    scannedBytes,
    scannedRows,
  };
}
