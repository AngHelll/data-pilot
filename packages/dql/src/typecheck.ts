import type { ColumnMeta, DataValue, Diagnostic, InferredType } from "@data-pilot/contracts";
import type { DqlQuery, Expr, Predicate, Stage } from "./ast.js";

export interface TypecheckResult {
  diagnostics: Diagnostic[];
  /** Param names referenced in the query. */
  params: string[];
}

function colType(
  columns: ColumnMeta[],
  name: string,
): { type: InferredType; spanOk: boolean } | null {
  const col = columns.find((c) => c.name === name);
  if (!col) return null;
  return { type: col.inferredType, spanOk: true };
}

function exprType(
  expr: Expr,
  columns: ColumnMeta[],
  params: Record<string, DataValue | undefined>,
  diagnostics: Diagnostic[],
  paramNames: Set<string>,
): InferredType | "param" | "null" | "missing" {
  switch (expr.kind) {
    case "column": {
      const c = colType(columns, expr.name);
      if (!c) {
        diagnostics.push({
          code: "unknown-column",
          severity: "error",
          message: `Unknown column '${expr.name}'`,
          range: expr.span,
        });
        return "unknown";
      }
      return c.type;
    }
    case "string":
      return "string";
    case "integer":
      return "integer";
    case "decimal":
      return "decimal";
    case "boolean":
      return "boolean";
    case "null":
      return "null";
    case "missing":
      return "missing";
    case "param": {
      paramNames.add(expr.name);
      const bound = params[expr.name];
      if (!bound) return "param";
      if (bound.kind === "null") return "null";
      if (bound.kind === "missing") return "missing";
      return bound.kind;
    }
    case "date":
      return "date";
  }
}

function compatible(a: InferredType | string, b: InferredType | string): boolean {
  if (a === "unknown" || b === "unknown" || a === "mixed" || b === "mixed") return true;
  if (a === "param" || b === "param") return true;
  if (a === "null" || b === "null" || a === "missing" || b === "missing") return true;
  if (a === b) return true;
  if (
    (a === "integer" || a === "decimal") &&
    (b === "integer" || b === "decimal")
  ) {
    return true;
  }
  if (
    (a === "date" || a === "datetime") &&
    (b === "date" || b === "datetime" || b === "string")
  ) {
    return true;
  }
  return false;
}

function checkExpr(
  expr: Expr,
  columns: ColumnMeta[],
  params: Record<string, DataValue | undefined>,
  diagnostics: Diagnostic[],
  paramNames: Set<string>,
): void {
  exprType(expr, columns, params, diagnostics, paramNames);
  if (expr.kind === "date") {
    checkExpr(expr.arg, columns, params, diagnostics, paramNames);
  }
}

function checkPred(
  pred: Predicate,
  columns: ColumnMeta[],
  params: Record<string, DataValue | undefined>,
  diagnostics: Diagnostic[],
  paramNames: Set<string>,
): void {
  switch (pred.kind) {
    case "and":
    case "or":
      checkPred(pred.left, columns, params, diagnostics, paramNames);
      checkPred(pred.right, columns, params, diagnostics, paramNames);
      break;
    case "not":
      checkPred(pred.inner, columns, params, diagnostics, paramNames);
      break;
    case "is":
      checkExpr(pred.expr, columns, params, diagnostics, paramNames);
      break;
    case "contains":
      checkExpr(pred.expr, columns, params, diagnostics, paramNames);
      break;
    case "in":
      checkExpr(pred.expr, columns, params, diagnostics, paramNames);
      for (const v of pred.values) checkExpr(v, columns, params, diagnostics, paramNames);
      break;
    case "cmp": {
      const lt = exprType(pred.left, columns, params, diagnostics, paramNames);
      const rt = exprType(pred.right, columns, params, diagnostics, paramNames);
      if (!compatible(lt, rt)) {
        diagnostics.push({
          code: "type-mismatch",
          severity: "error",
          message: `Cannot compare ${lt} with ${rt}`,
          range: pred.span,
        });
      }
      break;
    }
  }
}

function checkStage(
  stage: Stage,
  columns: ColumnMeta[],
  params: Record<string, DataValue | undefined>,
  diagnostics: Diagnostic[],
  paramNames: Set<string>,
): void {
  switch (stage.kind) {
    case "find":
      if (stage.columns) {
        for (const name of stage.columns) {
          if (!columns.some((c) => c.name === name)) {
            diagnostics.push({
              code: "unknown-column",
              severity: "error",
              message: `Unknown column '${name}' in find`,
              range: stage.span,
            });
          }
        }
      }
      break;
    case "where":
      checkPred(stage.predicate, columns, params, diagnostics, paramNames);
      break;
    case "select":
      for (const name of stage.columns) {
        if (!columns.some((c) => c.name === name)) {
          diagnostics.push({
            code: "unknown-column",
            severity: "error",
            message: `Unknown column '${name}'`,
            range: stage.span,
          });
        }
      }
      break;
    case "take":
    case "count":
    case "expectCount":
    case "expectUnique":
      break;
  }
}

export function typecheck(
  query: DqlQuery,
  columns: ColumnMeta[],
  params: Record<string, DataValue | undefined> = {},
): TypecheckResult {
  const diagnostics: Diagnostic[] = [];
  const paramNames = new Set<string>();
  for (const stage of query.stages) {
    checkStage(stage, columns, params, diagnostics, paramNames);
  }
  const uniqueStage = query.stages.find((s) => s.kind === "expectUnique");
  if (uniqueStage?.kind === "expectUnique") {
    const known = columns.some((c) => c.name === uniqueStage.column);
    const selectStage = query.stages.find((s) => s.kind === "select");
    const inSelect =
      selectStage?.kind === "select" && selectStage.columns.includes(uniqueStage.column);
    if (!known || (selectStage && !inSelect)) {
      diagnostics.push({
        code: "unknown-column",
        severity: "error",
        message: `Unknown column '${uniqueStage.column}'`,
        range: uniqueStage.span,
      });
    }
  }
  for (const name of paramNames) {
    if (params[name] === undefined) {
      diagnostics.push({
        code: "unbound-parameter",
        severity: "error",
        message: `Unbound parameter $${name}`,
      });
    }
  }
  return { diagnostics, params: [...paramNames] };
}
