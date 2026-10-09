import type { DqlQuery, Expr, Predicate, Span } from "./ast.js";
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
