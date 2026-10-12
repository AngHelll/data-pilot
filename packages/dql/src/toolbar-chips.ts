import type { DqlQuery, Expr, Predicate, Span, Stage } from "./ast.js";
import { formatDql } from "./format.js";
import { parseDql, ParseError } from "./parse.js";

const ZERO: Span = { start: 0, end: 0 };

export interface ToolbarCmp {
  column: string;
  op: string;
  value: string;
}

export interface ToolbarChips {
  /** null when a where is present and it is not only toolbar comparisons joined with and. */
  filters: ToolbarCmp[] | null;
  /** null when no find lists exactly these columns without a case mode. */
  search: string | null;
}

/** Comparisons the editor toolbar can show. Does not run the query. */
export function readToolbarChips(source: string, columns: readonly string[]): ToolbarChips {
  const query = parsed(source);
  if (query === null) return { filters: null, search: null };
  if (query === "") return { filters: [], search: null };
  return {
    filters: whereFilters(query),
    search: toolbarFind(query, columns)?.needle ?? null,
  };
}

/**
 * Remove one toolbar comparison or the matching find, and keep every other stage.
 * Returns null when that chip is not one the toolbar showed.
 */
export function dropToolbarChip(
  source: string,
  columns: readonly string[],
  drop: { filter?: number; search?: boolean },
): string | null {
  const query = parsed(source);
  if (query === null || query === "") return null;
  if (drop.search) {
    const find = toolbarFind(query, columns);
    if (!find) return null;
    query.stages.splice(find.index, 1);
    return formatDql(query);
  }
  if (drop.filter === undefined) return null;
  const whereAt = whereIndex(query);
  if (whereAt === null) return null;
  const where = query.stages[whereAt];
  if (!where || where.kind !== "where") return null;
  const parts = conjunction(where.predicate);
  if (!parts || drop.filter < 0 || drop.filter >= parts.length) return null;
  parts.splice(drop.filter, 1);
  if (parts.length === 0) query.stages.splice(whereAt, 1);
  else query.stages[whereAt] = { kind: "where", predicate: joinAnd(parts), span: where.span };
  return formatDql(query);
}

const CMP_OPS = ["=", "!=", "<", "<=", ">", ">="] as const;
const CANONICAL_NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

/**
 * And one toolbar comparison onto the query and keep every other stage.
 * Returns null when the where is not a toolbar conjunction, or the comparison is not one.
 * Does not run the query.
 */
export function addToolbarFilter(source: string, add: ToolbarCmp): string | null {
  const query = parsed(source);
  if (query === null) return null;
  const predicate = comparisonPredicate(add);
  if (!predicate) return null;
  if (query === "") return formatQuery([{ kind: "where", predicate, span: ZERO }]);
  if (whereIndex(query) === null && query.stages.some((stage) => stage.kind === "where")) return null;
  const whereAt = whereIndex(query);
  if (whereAt === null) {
    insertWhere(query, { kind: "where", predicate, span: ZERO });
    return formatDql(query);
  }
  const where = query.stages[whereAt];
  if (!where || where.kind !== "where") return null;
  const parts = conjunction(where.predicate);
  if (!parts) return null;
  parts.push(predicate);
  query.stages[whereAt] = { kind: "where", predicate: joinAnd(parts), span: where.span };
  return formatDql(query);
}

/**
 * Insert or replace the toolbar find and keep every other stage.
 * Returns null when a find is present and it is not the toolbar find for these columns.
 * Does not run the query.
 */
export function addToolbarSearch(
  source: string,
  columns: readonly string[],
  needle: string,
): string | null {
  const text = needle.trim();
  const names = columns.map((name) => name.trim()).filter((name) => name.length > 0);
  if (!text || names.length === 0) return null;
  const query = parsed(source);
  if (query === null) return null;
  const findStage: Stage = {
    kind: "find",
    needle: text,
    columns: names,
    caseMode: "insensitive",
    span: ZERO,
  };
  if (query === "") return formatQuery([findStage]);
  if (query.stages.some((stage) => stage.kind === "find")) {
    const found = toolbarFind(query, names);
    if (!found) return null;
    query.stages[found.index] = findStage;
    return formatDql(query);
  }
  query.stages.unshift(findStage);
  return formatDql(query);
}

function formatQuery(stages: Stage[]): string {
  return formatDql({ version: "0.1", source: "", stages });
}

function comparisonPredicate(cmp: ToolbarCmp): Predicate | null {
  const column = cmp.column.trim();
  const op = cmp.op.trim();
  if (!column) return null;
  if (op === "is null" || op === "is not null") {
    return {
      kind: "is",
      expr: { kind: "column", name: column, span: ZERO },
      test: "null",
      negated: op === "is not null",
      span: ZERO,
    };
  }
  if (!(CMP_OPS as readonly string[]).includes(op)) return null;
  return {
    kind: "cmp",
    op: op as (typeof CMP_OPS)[number],
    left: { kind: "column", name: column, span: ZERO },
    right: literalFromToolbar(cmp.value),
    span: ZERO,
  };
}

function literalFromToolbar(value: string): Expr {
  if (value === "true" || value === "false") {
    return { kind: "boolean", value: value === "true", span: ZERO };
  }
  if (CANONICAL_NUMBER.test(value)) {
    return { kind: value.includes(".") ? "decimal" : "integer", value, span: ZERO };
  }
  return { kind: "string", value, span: ZERO };
}

function insertWhere(query: DqlQuery, stage: Stage): void {
  const at = query.stages.findIndex(
    (item) =>
      item.kind === "select" ||
      item.kind === "take" ||
      item.kind === "count" ||
      item.kind === "expectCount" ||
      item.kind === "expectUnique" ||
      item.kind === "whenExpect",
  );
  if (at < 0) query.stages.push(stage);
  else query.stages.splice(at, 0, stage);
}

function parsed(source: string): DqlQuery | "" | null {
  const trimmed = source.trim();
  if (!trimmed) return "";
  try {
    return parseDql(trimmed);
  } catch (err) {
    if (err instanceof ParseError) return null;
    throw err;
  }
}

function whereFilters(query: DqlQuery): ToolbarCmp[] | null {
  const wheres = query.stages.filter((stage) => stage.kind === "where");
  if (wheres.length > 1) return null;
  if (wheres.length === 0) return [];
  const where = wheres[0];
  if (!where || where.kind !== "where") return null;
  const parts = conjunction(where.predicate);
  if (!parts) return null;
  const filters: ToolbarCmp[] = [];
  for (const part of parts) {
    const cmp = toCmp(part);
    if (!cmp) return null;
    filters.push(cmp);
  }
  return filters;
}

function whereIndex(query: DqlQuery): number | null {
  let found = -1;
  for (let i = 0; i < query.stages.length; i++) {
    if (query.stages[i]?.kind !== "where") continue;
    if (found >= 0) return null;
    found = i;
  }
  return found >= 0 ? found : null;
}

function conjunction(predicate: Predicate): Predicate[] | null {
  if (predicate.kind === "and") {
    const left = conjunction(predicate.left);
    const right = conjunction(predicate.right);
    if (!left || !right) return null;
    return [...left, ...right];
  }
  if (!toCmp(predicate)) return null;
  return [predicate];
}

function joinAnd(parts: Predicate[]): Predicate {
  const first = parts[0];
  if (!first) throw new Error("dropToolbarChip expected a comparison");
  return parts.slice(1).reduce<Predicate>((left, right) => ({ kind: "and", left, right, span: ZERO }), first);
}

function toCmp(predicate: Predicate): ToolbarCmp | null {
  if (predicate.kind === "cmp") {
    if (predicate.left.kind !== "column") return null;
    const value = literalText(predicate.right);
    if (value === null) return null;
    return { column: predicate.left.name, op: predicate.op, value };
  }
  if (predicate.kind === "is") {
    if (predicate.expr.kind !== "column" || predicate.test !== "null") return null;
    return { column: predicate.expr.name, op: predicate.negated ? "is not null" : "is null", value: "" };
  }
  return null;
}

function literalText(expr: Expr): string | null {
  switch (expr.kind) {
    case "string":
    case "integer":
    case "decimal":
      return expr.value;
    case "boolean":
      return expr.value ? "true" : "false";
    default:
      return null;
  }
}

function toolbarFind(
  query: DqlQuery,
  columns: readonly string[],
): { index: number; needle: string } | null {
  let found: { index: number; needle: string } | null = null;
  for (let i = 0; i < query.stages.length; i++) {
    const stage = query.stages[i];
    if (!stage || stage.kind !== "find") continue;
    if (found) return null;
    if (stage.caseMode !== "insensitive" || !stage.columns) return null;
    if (stage.columns.length !== columns.length) return null;
    for (let c = 0; c < columns.length; c++) {
      if (stage.columns[c] !== columns[c]) return null;
    }
    found = { index: i, needle: stage.needle };
  }
  return found;
}
