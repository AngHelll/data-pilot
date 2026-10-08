import type { SavedQuery } from "@data-pilot/contracts";
import { fileName, type DqlDocumentLink } from "./dql-link";

export const MAX_SAVED_QUERIES = 50;
const LABEL_LIMIT = 80;

/** Newest first, capped. The same dql and datasetPath replace earlier rows. */
export function nextSavedQueries(existing: readonly SavedQuery[], query: SavedQuery): SavedQuery[] {
  const rest = existing.filter((row) => !sameQueryTarget(row, query));
  return [query, ...rest].slice(0, MAX_SAVED_QUERIES);
}

/** Point one saved row at a dataset. Does not fill other rows that lack a path. */
export function associateSavedQuery(
  existing: readonly SavedQuery[],
  query: SavedQuery,
  datasetPath: string,
): SavedQuery[] {
  const rest = existing.filter((row) => !sameSavedRow(row, query));
  return nextSavedQueries(rest, rememberDatasetPath(query, datasetPath));
}

function sameQueryTarget(row: SavedQuery, query: SavedQuery): boolean {
  return row.dql === query.dql && row.datasetPath === query.datasetPath;
}

function sameSavedRow(row: SavedQuery, query: SavedQuery): boolean {
  return sameQueryTarget(row, query) && row.savedAtMs === query.savedAtMs;
}

/** Attach the path of this save. No path leaves the query unchanged. */
export function rememberDatasetPath(saved: SavedQuery, datasetPath: string | undefined): SavedQuery {
  if (!datasetPath) return saved;
  return { ...saved, datasetPath };
}

/** Tree label. A query with no path does not borrow another session. */
export function savedQueryPresentation(query: SavedQuery): {
  label: string;
  description: string;
  tooltip: string;
} {
  const singleLine = query.dql.replace(/\s+/g, " ").trim();
  const label =
    singleLine.length <= LABEL_LIMIT ? singleLine : `${singleLine.slice(0, LABEL_LIMIT - 1)}…`;
  const description = query.datasetPath ? fileName(query.datasetPath) : "No dataset";
  const tooltip = query.datasetPath ? `${query.datasetPath}\n${query.dql}` : query.dql;
  return { label, description, tooltip };
}

/** Link stored outside the .dql text. Missing path means Run must ask. */
export function savedQueryLink(query: SavedQuery): DqlDocumentLink | undefined {
  if (!query.datasetPath) return undefined;
  return {
    datasetPath: query.datasetPath,
    columns: query.schemaColumnNames.map((name) => ({ name, inferredType: "" })),
  };
}
