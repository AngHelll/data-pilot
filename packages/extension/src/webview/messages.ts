import type {
  ColumnMeta,
  DatasetHandle,
  Diagnostic,
  ExportFormat,
  QueryResult,
  SavedQuery,
  TrustMode,
} from "@data-pilot/contracts";
import { FILTER_OPS } from "../filter-dql";
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
  | { type: "queryLoaded"; dql: string }
  | { type: "staleSource"; message: string }
  | {
      type: "session";
      handle: DatasetHandle;
      describe: SerializedDescribe;
      ingestDiagnostics: Diagnostic[];
      preview: SerializedGrid;
    }
  | {
      type: "dqlPlan";
      ok: boolean;
      formatted?: string;
      diagnostics: Diagnostic[];
    }
  | {
      type: "queryResult";
      result: SerializedGrid;
      diagnostics: Diagnostic[];
    }
  | {
      type: "inspectResult";
      rowIndex: number;
      column: string;
      display: string;
      raw: string;
      inferredType: string;
    }
  | { type: "editPreview"; preview: SerializedEditPreview }
  | {
      type: "editApplied";
      handle: DatasetHandle;
      describe: SerializedDescribe;
      ingestDiagnostics: Diagnostic[];
      preview: SerializedGrid;
    }
  | { type: "queryState"; running: boolean }
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
  | { type: "planDql"; dql: string }
  | { type: "saveQuery"; dql: string }
  | { type: "exportQuery"; dql: string; format?: ExportFormat }
  | { type: "loadSavedQuery"; savedAtMs: number }
  | { type: "reopenDataset" }
  | { type: "webviewReady" }
  | { type: "cancelQuery" }
  | { type: "inspectCell"; rowIndex: number; column: string }
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
      search?: string;
      columns: string[];
    };

export interface SerializedGrid {
  mode: "preview" | "query";
  columns: string[];
  columnTypes?: ColumnMeta[];
  rows: string[][];
  rowCountReturned: number;
  completion: QueryResult["completion"];
  scope: QueryResult["scope"];
  totalCount?: number;
  scannedBytes?: number;
  scannedRows?: number;
}

const MAX_DQL_LENGTH = 16_384;
const MAX_CELL_LENGTH = 8_192;

function validIndex(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 1_000_000;
}

function validColumn(name: unknown): name is string {
  return typeof name === "string" && name.length > 0 && name.length <= 256;
}

export function parseWebviewMessage(raw: unknown): WebviewToHostMessage | null {
  if (typeof raw !== "object" || raw === null) return null;
  const msg = raw as Record<string, unknown>;
  if (typeof msg.type !== "string") return null;

  switch (msg.type) {
    case "runQuery":
    case "planDql": {
      if (typeof msg.dql !== "string") return null;
      const dql = msg.dql.trim();
      if (!dql || dql.length > MAX_DQL_LENGTH) return null;
      return { type: msg.type, dql };
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
    case "webviewReady":
      return { type: "webviewReady" };
    case "cancelQuery":
      return { type: "cancelQuery" };
    case "inspectCell": {
      if (!validIndex(msg.rowIndex) || !validColumn(msg.column)) return null;
      return { type: "inspectCell", rowIndex: msg.rowIndex, column: msg.column };
    }
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
      if (!Array.isArray(msg.columns) || msg.columns.length > 200) return null;
      const columns: string[] = [];
      for (const name of msg.columns) {
        if (!validColumn(name)) return null;
        columns.push(name);
      }
      return {
        type: "applyFilter",
        ...(typeof column === "string" && column.length > 0 ? { column } : {}),
        ...(typeof op === "string" && op.length > 0 ? { op } : {}),
        ...(typeof value === "string" ? { value } : {}),
        ...(typeof search === "string" ? { search } : {}),
        columns,
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
