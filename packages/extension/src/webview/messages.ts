import type {
  ColumnMeta,
  DatasetHandle,
  Diagnostic,
  ExportFormat,
  QueryResult,
  SavedQuery,
  TrustMode,
} from "@data-pilot/contracts";
import { FILTER_OPS, type FilterCmp } from "../filter-dql";
/** Host → webview (validated before postMessage). */
export interface SerializedEditPreview {
  path: string;
  rowIndex: number;
  column: string;
  oldRaw: string;
  newRaw: string;
  unifiedDiff: string;
}

export interface SerializedDescribe {
  path: string;
  format: "csv" | "jsonl";
  sizeBytes: number;
  mtimeMs: number;
  revisionId: string;
  columns: ColumnMeta[];
}

/** Host → webview (validated before postMessage). */
export type HostToWebviewMessage =
  | {
      type: "init";
      trustMode: TrustMode;
      canExecuteQuery: boolean;
      canEdit: boolean;
      canExport: boolean;
      savedQueries: SavedQuery[];
    }
  | { type: "savedQueries"; queries: SavedQuery[] }
  | { type: "exportDone"; path: string; rowCount: number }
  | { type: "queryLoaded"; dql: string; chipFilters: FilterCmp[] | null; chipSearch: string | null }
  | { type: "staleSource"; message: string }
  | { type: "revertState"; available: boolean }
  | {
      type: "session";
      handle: DatasetHandle;
      describe: SerializedDescribe;
      ingestDiagnostics: Diagnostic[];
      preview: SerializedGrid;
      datasetColor: string;
    }
  | {
      type: "dqlPlan";
      ok: boolean;
      formatted?: string;
      diagnostics: Diagnostic[];
      /** Query this plan belongs to. A late plan does not repaint chips for a newer text. */
      dql?: string;
      chipFilters?: FilterCmp[] | null;
      chipSearch?: string | null;
    }
  | {
      type: "queryResult";
      result: SerializedGrid;
      diagnostics: Diagnostic[];
      elapsedMs?: number;
      resultTitle?: string;
      offset?: number;
    }
  | {
      type: "inspectResult";
      rowIndex: number;
      column: string;
      display: string;
      raw: string;
      inferredType: string;
    }
  | { type: "inspectorHosted"; hosted: boolean }
  | { type: "showEditorTab"; tab: "data" | "result" }
  | { type: "editPreview"; preview: SerializedEditPreview }
  | {
      type: "editApplied";
      handle: DatasetHandle;
      describe: SerializedDescribe;
      ingestDiagnostics: Diagnostic[];
      preview: SerializedGrid;
    }
  | { type: "queryState"; running: boolean }
  | { type: "previewPage"; offset: number; preview: SerializedGrid }
  | {
      type: "comparePeers";
      peers: { datasetId: string; label: string; columns: string[] }[];
    }
  | {
      type: "compareResult";
      completion: "complete" | "error";
      diagnostics: Diagnostic[];
      onlyLeft: string[];
      onlyRight: string[];
      changed: { key: string; columns: string[] }[];
    }
  | { type: "error"; message: string }
  | { type: "idle"; message: string }
  | { type: "requestDql"; requestId: string };

/** Webview → host (validated in panel handler). */
export type WebviewToHostMessage =
  | { type: "runQuery"; dql: string }
  | { type: "changePage"; surface: "preview" | "query"; offset: number; dql?: string }
  | { type: "planDql"; dql: string; columns?: string[] }
  | { type: "saveQuery"; dql: string }
  | { type: "exportQuery"; dql: string; format?: ExportFormat }
  | { type: "loadSavedQuery"; savedAtMs: number }
  | { type: "reopenDataset" }
  | { type: "revertLastEdit" }
  | { type: "webviewReady" }
  | { type: "cancelQuery" }
  | { type: "openQueryInEditor" }
  | { type: "inspectCell"; rowIndex: number; column: string; dataCell: boolean }
  | { type: "inspectorFocus" }
  | { type: "copyText"; text: string }
  | { type: "reportDql"; requestId: string; dql: string }
  | { type: "proposeEdit"; rowIndex: number; column: string; newRaw: string }
  | { type: "applyEdit"; rowIndex: number; column: string; newRaw: string }
  | { type: "compareDatasets"; rightDatasetId: string; column: string }
  | {
      type: "applyFilter";
      column?: string;
      op?: string;
      value?: string;
      filters?: { column: string; op: string; value?: string }[];
      search?: string;
      columns: string[];
      project?: boolean;
      /** Current query when a chip is removed. The host rewrites that text and does not run it. */
      keepDql?: string;
      dropFilter?: number;
      dropSearch?: boolean;
    };

export interface SerializedGrid {
  mode: "preview" | "query";
  columns: string[];
  columnTypes?: ColumnMeta[];
  rows: string[][];
  sourceRowIndexes?: number[];
  rowCountReturned: number;
  completion: QueryResult["completion"];
  scope: QueryResult["scope"];
  totalCount?: number;
  scannedBytes?: number;
  scannedRows?: number;
  /** Preview or Result sentence, including the returned-row range. */
  footer?: string;
  cellPill?: boolean[];
  cellAlignEnd?: boolean[];
}

const MAX_DQL_LENGTH = 16_384;
const MAX_CELL_LENGTH = 8_192;

function validIndex(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 1_000_000;
}

function validColumn(name: unknown): name is string {
  return typeof name === "string" && name.length > 0 && name.length <= 256;
}

function parseColumnList(raw: unknown): string[] | undefined | null {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.length > 200) return null;
  const columns: string[] = [];
  for (const name of raw) {
    if (!validColumn(name)) return null;
    columns.push(name);
  }
  return columns;
}

function parseFilters(
  raw: unknown,
): { column: string; op: string; value?: string }[] | undefined | null {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.length > 32) return null;
  const filters: { column: string; op: string; value?: string }[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) return null;
    const cmp = item as Record<string, unknown>;
    if (!validColumn(cmp.column)) return null;
    if (typeof cmp.op !== "string" || !(FILTER_OPS as readonly string[]).includes(cmp.op)) return null;
    if (cmp.value !== undefined && (typeof cmp.value !== "string" || cmp.value.length > MAX_CELL_LENGTH)) {
      return null;
    }
    filters.push({
      column: cmp.column,
      op: cmp.op,
      ...(typeof cmp.value === "string" ? { value: cmp.value } : {}),
    });
  }
  return filters;
}

export function parseWebviewMessage(raw: unknown): WebviewToHostMessage | null {
  if (typeof raw !== "object" || raw === null) return null;
  const msg = raw as Record<string, unknown>;
  if (typeof msg.type !== "string") return null;

  switch (msg.type) {
    case "changePage": {
      if (msg.surface !== "preview" && msg.surface !== "query") return null;
      if (!validIndex(msg.offset)) return null;
      if (msg.surface === "preview") return { type: "changePage", surface: "preview", offset: msg.offset };
      if (typeof msg.dql !== "string") return null;
      const dql = msg.dql.trim();
      if (!dql || dql.length > MAX_DQL_LENGTH) return null;
      return { type: "changePage", surface: "query", offset: msg.offset, dql };
    }
    case "runQuery":
    case "planDql": {
      if (typeof msg.dql !== "string") return null;
      const dql = msg.dql.trim();
      if (!dql || dql.length > MAX_DQL_LENGTH) return null;
      if (msg.type === "runQuery") return { type: "runQuery", dql };
      const columns = parseColumnList(msg.columns);
      if (columns === null) return null;
      return { type: "planDql", dql, ...(columns !== undefined ? { columns } : {}) };
    }
    case "saveQuery": {
      if (typeof msg.dql !== "string") return null;
      const dql = msg.dql.trim();
      if (!dql || dql.length > MAX_DQL_LENGTH) return null;
      return { type: "saveQuery", dql };
    }
    case "exportQuery": {
      if (typeof msg.dql !== "string") return null;
      const dql = msg.dql.trim();
      if (!dql || dql.length > MAX_DQL_LENGTH) return null;
      const format = msg.format;
      if (
        format !== undefined &&
        format !== "csv" &&
        format !== "jsonl" &&
        format !== "same-as-source"
      ) {
        return null;
      }
      return {
        type: "exportQuery",
        dql,
        ...(format !== undefined ? { format } : {}),
      };
    }
    case "loadSavedQuery": {
      if (typeof msg.savedAtMs !== "number" || !Number.isFinite(msg.savedAtMs)) return null;
      return { type: "loadSavedQuery", savedAtMs: msg.savedAtMs };
    }
    case "reopenDataset":
      return { type: "reopenDataset" };
    case "revertLastEdit":
      return { type: "revertLastEdit" };
    case "webviewReady":
      return { type: "webviewReady" };
    case "cancelQuery":
      return { type: "cancelQuery" };
    case "openQueryInEditor":
      return { type: "openQueryInEditor" };
    case "inspectCell": {
      if (!validIndex(msg.rowIndex) || !validColumn(msg.column)) return null;
      return {
        type: "inspectCell",
        rowIndex: msg.rowIndex,
        column: msg.column,
        dataCell: msg.dataCell === true,
      };
    }
    case "inspectorFocus":
      return { type: "inspectorFocus" };
    case "copyText": {
      if (typeof msg.text !== "string" || msg.text.length > MAX_CELL_LENGTH) return null;
      return { type: "copyText", text: msg.text };
    }
    case "reportDql": {
      if (typeof msg.requestId !== "string" || msg.requestId.length === 0 || msg.requestId.length > 80) {
        return null;
      }
      if (typeof msg.dql !== "string" || msg.dql.length > MAX_DQL_LENGTH) return null;
      return { type: "reportDql", requestId: msg.requestId, dql: msg.dql };
    }
    case "applyFilter": {
      const columns = parseColumnList(msg.columns);
      if (columns === undefined || columns === null) return null;
      if (typeof msg.keepDql === "string") {
        const keepDql = msg.keepDql.trim();
        if (!keepDql || keepDql.length > MAX_DQL_LENGTH) return null;
        const dropSearch = msg.dropSearch === true;
        if (msg.dropSearch !== undefined && typeof msg.dropSearch !== "boolean") return null;
        if (dropSearch) {
          if (msg.dropFilter !== undefined) return null;
          return { type: "applyFilter", columns, keepDql, dropSearch: true };
        }
        if (!validIndex(msg.dropFilter)) return null;
        return { type: "applyFilter", columns, keepDql, dropFilter: msg.dropFilter };
      }
      const column = msg.column;
      const op = msg.op;
      const value = msg.value;
      const search = msg.search;
      if (column !== undefined && (typeof column !== "string" || (column !== "" && !validColumn(column)))) {
        return null;
      }
      if (op !== undefined && (typeof op !== "string" || !(FILTER_OPS as readonly string[]).includes(op))) {
        return null;
      }
      if (value !== undefined && (typeof value !== "string" || value.length > MAX_CELL_LENGTH)) return null;
      if (search !== undefined && (typeof search !== "string" || search.length > MAX_CELL_LENGTH)) return null;
      const filters = parseFilters(msg.filters);
      if (filters === null) return null;
      if (msg.project !== undefined && typeof msg.project !== "boolean") return null;
      return {
        type: "applyFilter",
        ...(typeof column === "string" && column.length > 0 ? { column } : {}),
        ...(typeof op === "string" && op.length > 0 ? { op } : {}),
        ...(typeof value === "string" ? { value } : {}),
        ...(typeof search === "string" ? { search } : {}),
        ...(filters !== undefined ? { filters } : {}),
        columns,
        ...(msg.project === true ? { project: true } : {}),
      };
    }
    case "compareDatasets": {
      if (!validColumn(msg.column) || !validColumn(msg.rightDatasetId)) return null;
      return { type: "compareDatasets", rightDatasetId: msg.rightDatasetId, column: msg.column };
    }
    case "proposeEdit":
    case "applyEdit": {
      if (!validIndex(msg.rowIndex) || !validColumn(msg.column)) return null;
      if (typeof msg.newRaw !== "string" || msg.newRaw.length > MAX_CELL_LENGTH) return null;
      return {
        type: msg.type,
        rowIndex: msg.rowIndex,
        column: msg.column,
        newRaw: msg.newRaw,
      };
    }
    default:
      return null;
  }
}
