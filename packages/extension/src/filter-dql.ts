/** Build a DQL 0.1 where/find/select from the editor toolbar. Does not run a query. No vscode. */

export const FILTER_OPS = ["=", "!=", ">", "<", ">=", "<=", "is null", "is not null"] as const;

export type FilterOp = (typeof FILTER_OPS)[number];

export interface FilterCmp {
  column: string;
  op: string;
  value?: string;
}

export interface FilterDraft {
  column?: string;
  op?: string;
  value?: string;
  /** Every comparison of the where, joined with and. Omitted uses column/op/value. */
  filters?: readonly FilterCmp[];
  search?: string;
  columns: readonly string[];
  /** When true, append select of columns. Omitted means the draft does not project. */
  project?: boolean;
}

const CANONICAL_NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

export function filterToDql(draft: FilterDraft): string | null {
  const search = draft.search?.trim() ?? "";
  const comparisons = comparisonList(draft);
  if (!comparisons) return null;
  const project = draft.project === true ? selectClause(draft.columns) : null;
  if (comparisons.length === 0 && search.length === 0 && !project) return null;

  const where = comparisons.length > 0 ? whereAll(comparisons) : null;
  const find = search.length > 0 ? findClause(search, draft.columns) : null;
  if (comparisons.length > 0 && !where) return null;
  if (search.length > 0 && !find) return null;
  const parts = [find, where, project].filter((part): part is string => part !== null);
  if (parts.length === 0) return null;
  return parts.join(" | ");
}

function comparisonList(draft: FilterDraft): FilterCmp[] | null {
  if (draft.filters) {
    const list: FilterCmp[] = [];
    for (const filter of draft.filters) {
      const column = filter.column.trim();
      const op = filter.op.trim();
      if (!column || !op || !isFilterOp(op)) return null;
      list.push({ column, op, value: filter.value ?? "" });
    }
    return list;
  }
  const column = draft.column?.trim() ?? "";
  const op = draft.op?.trim() ?? "";
  if (!column || !op) return [];
  if (!isFilterOp(op)) return null;
  return [{ column, op, value: draft.value ?? "" }];
}

function whereAll(filters: readonly FilterCmp[]): string | null {
  const parts: string[] = [];
  for (const filter of filters) {
    if (!isFilterOp(filter.op)) return null;
    const clause = whereClause(filter.column, filter.op, filter.value ?? "");
    parts.push(clause.slice("where ".length));
  }
  if (parts.length === 0) return null;
  return `where ${parts.join(" and ")}`;
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

function selectClause(columns: readonly string[]): string | null {
  const names = columns.map((name) => name.trim()).filter((name) => name.length > 0);
  if (names.length === 0) return null;
  return `select ${names.map(quoteIdent).join(", ")}`;
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
