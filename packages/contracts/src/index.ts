/**
 * Shared DTOs and protocol types for Data Pilot.
 * No VS Code, UI, or native bindings allowed in this package.
 */

export const PROTOCOL_VERSION = 1 as const;

/** Exact tagged values — never coerce to JS Number for integers/decimals. */
export type DataValue =
  | { kind: "null" }
  | { kind: "missing" }
  | { kind: "string"; value: string }
  | { kind: "boolean"; value: boolean }
  | { kind: "integer"; value: string }
  | { kind: "decimal"; value: string }
  | { kind: "date"; value: string }
  | { kind: "datetime"; value: string };

export type InferredType =
  | "string"
  | "boolean"
  | "integer"
  | "decimal"
  | "date"
  | "datetime"
  | "mixed"
  | "unknown";

export interface ColumnMeta {
  name: string;
  inferredType: InferredType;
  nullCountSample?: number;
  missingCountSample?: number;
  sampleSize?: number;
  /** Distinct concrete values in the describe sample. Null and missing do not count. */
  distinctCountSample?: number;
  /** Canonical numeric minimum. Present only when inferredType is integer or decimal. */
  minSample?: string;
  /** Canonical numeric maximum. Present only when inferredType is integer or decimal. */
  maxSample?: string;
}

export interface DatasetRevision {
  /** Stable id for this open session's view of the file. */
  revisionId: string;
  path: string;
  sizeBytes: number;
  mtimeMs: number;
  /** Present only when computed — never required for open/preview. */
  contentHash?: string;
}

export interface DatasetHandle {
  datasetId: string;
  format: "csv" | "jsonl";
  revision: DatasetRevision;
  columns: ColumnMeta[];
}

export type DiagnosticSeverity = "error" | "warning" | "info" | "hint";

/**
 * Structured diagnostic for parse/plan/runtime issues.
 * Spans are optional until a parser attaches them.
 */
export interface Diagnostic {
  code: string;
  severity: DiagnosticSeverity;
  message: string;
  /** 0-based UTF-16 offsets into the source query/document when available. */
  range?: { start: number; end: number };
  path?: string;
  related?: Array<{ message: string; path?: string }>;
}

export interface KeyDiffChange {
  key: DataValue;
  columns: string[];
}

export interface KeyDiffResult {
  completion: "complete" | "error";
  diagnostics: Diagnostic[];
  onlyLeft: DataValue[];
  onlyRight: DataValue[];
  changed: KeyDiffChange[];
}

export interface QueryBudget {
  maxRows?: number;
  maxBytes?: number;
  maxScanBytes?: number;
  wallClockMs?: number;
}

export type CompletionState =
  | "complete"
  | "truncated"
  | "cancelled"
  | "partial"
  | "error";

export interface QueryResult {
  requestId: string;
  datasetId: string;
  revisionId: string;
  columns: string[];
  rows: DataValue[][];
  rowCountReturned: number;
  /** Exact only when completion === "complete" and operation is count/full scan. */
  totalCount?: number;
  completion: CompletionState;
  scope: "sample" | "prefix" | "full" | "unknown";
  diagnostics: Diagnostic[];
  /** Honest cost signals — not the same as returned row count. */
  scannedBytes?: number;
  scannedRows?: number;
}

export type JobState =
  | "queued"
  | "running"
  | "completed"
  | "cancelled"
  | "failed";

export interface JobInfo {
  jobId: string;
  requestId: string;
  state: JobState;
  startedAtMs?: number;
  finishedAtMs?: number;
  error?: Diagnostic;
}

export type TrustMode = "trusted" | "untrusted-limited";

/** Operations allowed under untrusted-limited (D-005). */
export const UNTRUSTED_ALLOWED_OPS = [
  "openDataset",
  "describeDataset",
  "preview",
  "fetchPage",
  "inspectValue",
  "cancelJob",
  "closeDataset",
] as const;

export type UntrustedAllowedOp = (typeof UNTRUSTED_ALLOWED_OPS)[number];

export const UNTRUSTED_BLOCKED_OPS = [
  "exportResult",
  "editFixture",
  "saveQuery",
  "globalScan",
  "agentQuery",
  "executeQuery",
  "compareDatasets",
] as const;

export type EngineOp =
  | "openDataset"
  | "describeDataset"
  | "preview"
  | "planQuery"
  | "executeQuery"
  | "fetchPage"
  | "inspectValue"
  | "cancelJob"
  | "exportResult"
  | "closeDataset"
  | "editFixture"
  | "saveQuery"
  | "globalScan"
  | "agentQuery"
  | "compareDatasets"
  | "ping"
  | "getStats";

export interface IpcRequest {
  protocolVersion: typeof PROTOCOL_VERSION;
  requestId: string;
  op: EngineOp;
  payload?: unknown;
}

export interface IpcSuccess {
  protocolVersion: typeof PROTOCOL_VERSION;
  requestId: string;
  ok: true;
  result: unknown;
}

export interface IpcFailure {
  protocolVersion: typeof PROTOCOL_VERSION;
  requestId: string;
  ok: false;
  error: Diagnostic;
}

export type IpcResponse = IpcSuccess | IpcFailure;

export function isStaleResponse(
  expectedRequestId: string,
  response: IpcResponse,
): boolean {
  return response.requestId !== expectedRequestId;
}

export function isUntrustedAllowed(op: EngineOp): boolean {
  return (UNTRUSTED_ALLOWED_OPS as readonly string[]).includes(op);
}

/** Default preview budgets (Phase 0 proposal; overridable per call). */
export const DEFAULT_PREVIEW_BUDGET: Required<
  Pick<QueryBudget, "maxRows" | "maxBytes">
> = {
  maxRows: 200,
  maxBytes: 1024 * 1024,
};

/** Bounded export from a DQL result (honest scan — not unbounded). */
export const DEFAULT_EXPORT_BUDGET: Required<
  Pick<QueryBudget, "maxRows" | "maxBytes">
> = {
  maxRows: 10_000,
  maxBytes: 10 * 1024 * 1024,
};

export type ExportFormat = "csv" | "jsonl" | "same-as-source";

/** Engine returns content only; host chooses an authorized write path (security). */
export interface ExportArtifact {
  format: "csv" | "jsonl";
  content: string;
  byteLength: number;
  rowCount: number;
  /** Basename suggestion derived from the source dataset path. */
  suggestedBasename: string;
  completion: CompletionState;
  diagnostics: Diagnostic[];
}

export interface OpenDatasetPayload {
  path: string;
  format?: "csv" | "jsonl" | "auto";
}

export interface PreviewPayload {
  datasetId: string;
  budget?: QueryBudget;
  /** Phase 0 spike hooks — ignored for real dataset preview. */
  allocateMb?: number;
  workMs?: number;
  crash?: boolean;
}

export interface ExecuteQueryPayload {
  datasetId: string;
  dql: string;
  params?: Record<string, DataValue | string | number | boolean | null>;
  budget?: QueryBudget;
}

export interface PlanQueryPayload {
  datasetId: string;
  dql: string;
  params?: Record<string, DataValue | string | number | boolean | null>;
}

export interface InspectValuePayload {
  datasetId: string;
  rowIndex: number;
  column: string;
}

export interface EditFixturePayload {
  datasetId: string;
  rowIndex: number;
  column: string;
  /** Raw cell text as entered by the user (not coerced). */
  newRaw: string;
  /** When true, writes the change after validation; default is diff-only preview. */
  apply?: boolean;
}

export interface SavedQuery {
  dqlVersion: "0.1";
  dql: string;
  params?: Record<string, DataValue>;
  schemaColumnNames: string[];
  savedAtMs: number;
  /** Dataset file this query was saved against. Absent on queries saved before this field. */
  datasetPath?: string;
}

export interface CompareDatasetsPayload {
  leftDatasetId: string;
  rightDatasetId: string;
  column: string;
  budget?: Pick<QueryBudget, "maxScanBytes">;
}

export interface SaveQueryPayload {
  datasetId: string;
  dql: string;
  params?: Record<string, DataValue | string | number | boolean | null>;
}

export interface ExportResultPayload {
  datasetId: string;
  dql: string;
  params?: Record<string, DataValue | string | number | boolean | null>;
  budget?: QueryBudget;
  format?: ExportFormat;
}

export * from "./values.js";
