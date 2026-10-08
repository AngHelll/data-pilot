/** Build a DQL 0.1 where/find from the editor toolbar. Does not run a query. No vscode. */

export const FILTER_OPS = ["=", "!=", ">", "<", ">=", "<=", "is null", "is not null"] as const;

export type FilterOp = (typeof FILTER_OPS)[number];

export interface FilterDraft {
  column?: string;
  op?: string;
  value?: string;
  search?: string;
  columns: readonly string[];
}

const CANONICAL_NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

export function filterToDql(draft: FilterDraft): string | null {
  const search = draft.search?.trim() ?? "";
  const column = draft.column?.trim() ?? "";
  const op = draft.op?.trim() ?? "";
  const hasFilter = column.length > 0 && op.length > 0;
  if (!hasFilter && search.length === 0) return null;
  if (hasFilter && !isFilterOp(op)) return null;

  const where = hasFilter && isFilterOp(op) ? whereClause(column, op, draft.value ?? "") : null;
  const find = search.length > 0 ? findClause(search, draft.columns) : null;
  if (hasFilter && !where) return null;
  if (search.length > 0 && !find) return null;
  if (find && where) return `${find} | ${where}`;
  return find ?? where;
}

function isFilterOp(op: string): op is FilterOp {
  return (FILTER_OPS as readonly string[]).includes(op);
}

function whereClause(column: string, op: FilterOp, value: string): string {
  const ident = quoteIdent(column);
  if (op === "is null" || op === "is not null") return `where ${ident} ${op}`;
  const literal = CANONICAL_NUMBER.test(value) ? value : JSON.stringify(value);
  return `where ${ident} ${op} ${literal}`;
}

function findClause(search: string, columns: readonly string[]): string | null {
  const names = columns.map((name) => name.trim()).filter((name) => name.length > 0);
  if (names.length === 0) return null;
  return `find ${JSON.stringify(search)} in ${names.map(quoteIdent).join(", ")}`;
}

function quoteIdent(name: string): string {
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return name;
  return `\`${name.replace(/`/g, "``")}\``;
}
