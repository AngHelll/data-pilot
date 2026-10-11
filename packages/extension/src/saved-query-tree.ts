import type { SavedQuery } from "@data-pilot/contracts";
import { clipLabel } from "./editor-chrome";
import { fileName, type DqlDocumentLink } from "./dql-link";

export const MAX_SAVED_QUERIES = 50;
const LABEL_LIMIT = 80;

/** Drop one saved row. Identity is text, dataset, and savedAtMs. */
export function withoutSavedQuery(
  existing: readonly SavedQuery[],
  query: SavedQuery,
): SavedQuery[] {
  return existing.filter((row) => !sameSavedRow(row, query));
}

/** Drop every saved row. */
export function withoutAllSavedQueries(): SavedQuery[] {
  return [];
}

/** True when this text and dataset have never been saved. */
export function savedQueryNeedsName(existing: readonly SavedQuery[], query: SavedQuery): boolean {
  return !existing.some((row) => sameQueryTarget(row, query));
}

/** Name stored for this exact text and dataset. Empty when the row has no name. */
export function savedQueryDisplayName(
  existing: readonly SavedQuery[],
  dql: string,
  datasetPath: string,
): string | undefined {
  const name = existing.find((row) => row.dql === dql && row.datasetPath === datasetPath)?.name?.trim();
  return name || undefined;
}

/** Change only the display name. Empty clears it. savedAtMs stays. */
export function renameSavedQuery(
  existing: readonly SavedQuery[],
  query: SavedQuery,
  name: string,
): SavedQuery[] {
  const trimmed = name.trim();
  return existing.map((row) => {
    if (!sameSavedRow(row, query)) return row;
    if (!trimmed) {
      const { name: _drop, ...rest } = row;
      return rest;
    }
    return { ...row, name: trimmed };
  });
}

/** Newest first, capped. The same dql and datasetPath replace earlier rows. */
export function nextSavedQueries(existing: readonly SavedQuery[], query: SavedQuery): SavedQuery[] {
  const previous = existing.find((row) => sameQueryTarget(row, query));
  const rest = existing.filter((row) => !sameQueryTarget(row, query));
  return [keepSavedName(previous, query), ...rest].slice(0, MAX_SAVED_QUERIES);
}

/** A repeat save without a name keeps the name already stored. */
function keepSavedName(previous: SavedQuery | undefined, query: SavedQuery): SavedQuery {
  const incoming = query.name?.trim();
  const kept = incoming || previous?.name?.trim();
  if (!kept) {
    if (!query.name) return query;
    const { name: _drop, ...rest } = query;
    return rest;
  }
  return { ...query, name: kept };
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
  const named = query.name?.trim();
  const label = clipLabel(named || query.dql, LABEL_LIMIT);
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
