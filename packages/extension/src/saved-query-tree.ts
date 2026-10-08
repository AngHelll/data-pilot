import type { SavedQuery } from "@data-pilot/contracts";
import { fileName, type DqlDocumentLink } from "./dql-link";

export const MAX_SAVED_QUERIES = 50;
const LABEL_LIMIT = 80;

/** Newest first, capped. Entries without datasetPath stay as they are. */
export function nextSavedQueries(existing: readonly SavedQuery[], query: SavedQuery): SavedQuery[] {
  return [query, ...existing].slice(0, MAX_SAVED_QUERIES);
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
