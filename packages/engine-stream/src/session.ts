import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  DEFAULT_PREVIEW_BUDGET,
  type ColumnMeta,
  type DatasetHandle,
  type DatasetRevision,
  type Diagnostic,
  type QueryBudget,
  type QueryResult,
  type DataValue,
} from "@data-pilot/contracts";
import { sampleCsv, iterateCsvRows } from "./csv.js";
import { sampleJsonl, iterateJsonlRows } from "./jsonl.js";
import { classifySample } from "./cell.js";
import {
  applyCellEdit,
  previewCellEdit,
  type CellEditTarget,
  type EditPreview,
} from "./fixture-edit.js";

export type DatasetFormat = "csv" | "jsonl";

export interface OpenOptions {
  format?: DatasetFormat | "auto";
}

interface SessionState {
  handle: DatasetHandle;
  header: string[];
  diagnostics: Diagnostic[];
  closed: boolean;
}

function detectFormat(filePath: string, explicit?: DatasetFormat | "auto"): DatasetFormat {
  if (explicit === "csv" || explicit === "jsonl") return explicit;
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".jsonl" || ext === ".ndjson") return "jsonl";
  return "csv";
}

async function readRevision(filePath: string): Promise<DatasetRevision> {
  const stat = await fs.stat(filePath);
  return {
    revisionId: randomUUID(),
    path: path.resolve(filePath),
    sizeBytes: stat.size,
    mtimeMs: Math.round(stat.mtimeMs),
  };
}

export class DatasetStore {
  private readonly sessions = new Map<string, SessionState>();

  async open(filePath: string, options: OpenOptions = {}): Promise<{
    handle: DatasetHandle;
    diagnostics: Diagnostic[];
  }> {
    const resolved = path.resolve(filePath);
    await fs.access(resolved);
    const format = detectFormat(resolved, options.format);
    const revision = await readRevision(resolved);

    const sample =
      format === "csv"
        ? await sampleCsv(resolved, {
            maxRows: DEFAULT_PREVIEW_BUDGET.maxRows,
            maxBytes: DEFAULT_PREVIEW_BUDGET.maxBytes,
          })
        : await sampleJsonl(resolved, {
            maxRows: DEFAULT_PREVIEW_BUDGET.maxRows,
            maxBytes: DEFAULT_PREVIEW_BUDGET.maxBytes,
          });

    if (sample.header.length === 0 && sample.diagnostics.some((d) => d.severity === "error")) {
      throw Object.assign(new Error(sample.diagnostics[0]?.message ?? "open failed"), {
        diagnostics: sample.diagnostics,
      });
    }

    // Promote column inferred types using classified samples (CSV stores raw strings).
    const columns: ColumnMeta[] = sample.columns.map((c) => ({ ...c }));

    const datasetId = randomUUID();
    const handle: DatasetHandle = {
      datasetId,
      format,
      revision,
      columns,
    };
    this.sessions.set(datasetId, {
      handle,
      header: sample.header,
      diagnostics: sample.diagnostics,
      closed: false,
    });
    return { handle, diagnostics: sample.diagnostics };
  }

  get(datasetId: string): SessionState {
    const s = this.sessions.get(datasetId);
    if (!s || s.closed) {
      throw Object.assign(new Error(`Unknown or closed dataset '${datasetId}'`), {
        code: "unknown-dataset",
      });
    }
    return s;
  }

  async assertFresh(datasetId: string): Promise<Diagnostic | null> {
    const s = this.get(datasetId);
    const stat = await fs.stat(s.handle.revision.path);
    if (
      stat.size !== s.handle.revision.sizeBytes ||
      Math.round(stat.mtimeMs) !== s.handle.revision.mtimeMs
    ) {
      return {
        code: "stale-source",
        severity: "error",
        message: "Dataset file changed on disk since open; close and reopen",
        path: s.handle.revision.path,
      };
    }
    return null;
  }

  describe(datasetId: string): {
    handle: DatasetHandle;
    diagnostics: Diagnostic[];
  } {
    const s = this.get(datasetId);
    return { handle: s.handle, diagnostics: [...s.diagnostics] };
  }

  async preview(
    datasetId: string,
    budget: QueryBudget = {},
    requestId = "preview",
    signal?: AbortSignal,
  ): Promise<QueryResult> {
    const stale = await this.assertFresh(datasetId);
    const s = this.get(datasetId);
    if (stale) {
      return {
        requestId,
        datasetId,
        revisionId: s.handle.revision.revisionId,
        columns: s.header,
        rows: [],
        rowCountReturned: 0,
        completion: "error",
        scope: "unknown",
        diagnostics: [stale],
      };
    }

    const maxRows = budget.maxRows ?? DEFAULT_PREVIEW_BUDGET.maxRows;
    const maxBytes = budget.maxBytes ?? DEFAULT_PREVIEW_BUDGET.maxBytes;
    const sampleOpts = {
      maxRows,
      maxBytes,
      ...(signal ? { signal } : {}),
    };
    const sample =
      s.handle.format === "csv"
        ? await sampleCsv(s.handle.revision.path, sampleOpts)
        : await sampleJsonl(s.handle.revision.path, sampleOpts);

    const rows = sample.rows.map((r) =>
      r.values.map((v, i) => promotePreviewValue(v, r.raw[i] ?? "", s.handle.columns[i]?.inferredType)),
    );

    return {
      requestId,
      datasetId,
      revisionId: s.handle.revision.revisionId,
      columns: sample.header,
      rows,
      rowCountReturned: rows.length,
      completion: signal?.aborted
        ? "cancelled"
        : sample.truncated
          ? "truncated"
          : "complete",
      scope: sample.truncated ? "prefix" : "full",
      diagnostics: [...s.diagnostics, ...sample.diagnostics],
      scannedBytes: sample.bytesRead,
      scannedRows: rows.length,
    };
  }

  async *iterate(
    datasetId: string,
    signal?: AbortSignal,
    onBytes?: (n: number) => void,
  ): AsyncGenerator<{ values: DataValue[]; raw: string[]; bytes: number }> {
    const s = this.get(datasetId);
    const opts = {
      ...(signal ? { signal } : {}),
      ...(onBytes ? { onBytes } : {}),
    };
    if (s.handle.format === "csv") {
      yield* iterateCsvRows(s.handle.revision.path, s.header, opts);
    } else {
      yield* iterateJsonlRows(s.handle.revision.path, s.header, opts);
    }
  }

  async inspect(
    datasetId: string,
    rowIndex: number,
    column: string,
  ): Promise<{ value: DataValue; raw: string; inferredType: string } | Diagnostic> {
    const stale = await this.assertFresh(datasetId);
    if (stale) return stale;
    const s = this.get(datasetId);
    const colIdx = s.header.indexOf(column);
    if (colIdx < 0) {
      return {
        code: "unknown-column",
        severity: "error",
        message: `Unknown column '${column}'`,
      };
    }
    let i = 0;
    for await (const row of this.iterate(datasetId)) {
      if (i === rowIndex) {
        const raw = row.raw[colIdx] ?? "";
        const value = promotePreviewValue(
          row.values[colIdx]!,
          raw,
          s.handle.columns[colIdx]?.inferredType,
        );
        return {
          value,
          raw,
          inferredType: s.handle.columns[colIdx]?.inferredType ?? "unknown",
        };
      }
      i += 1;
      if (i > rowIndex) break;
    }
    return {
      code: "row-out-of-range",
      severity: "error",
      message: `Row index ${rowIndex} is out of range for inspected prefix`,
    };
  }

  editTarget(datasetId: string, rowIndex: number, column: string): CellEditTarget {
    const s = this.get(datasetId);
    return {
      filePath: s.handle.revision.path,
      format: s.handle.format,
      rowIndex,
      column,
      header: [...s.header],
    };
  }

  async previewCellEdit(
    datasetId: string,
    rowIndex: number,
    column: string,
    newRaw: string,
  ): Promise<EditPreview> {
    const stale = await this.assertFresh(datasetId);
    if (stale) throw stale;
    return previewCellEdit(this.editTarget(datasetId, rowIndex, column), newRaw);
  }

  async applyCellEdit(
    datasetId: string,
    rowIndex: number,
    column: string,
    newRaw: string,
  ): Promise<EditPreview> {
    const stale = await this.assertFresh(datasetId);
    if (stale) throw stale;
    return applyCellEdit(this.editTarget(datasetId, rowIndex, column), newRaw);
  }

  close(datasetId: string): void {
    const s = this.sessions.get(datasetId);
    if (!s) return;
    s.closed = true;
    this.sessions.delete(datasetId);
  }

  closeAll(): void {
    this.sessions.clear();
  }
}

function promotePreviewValue(
  v: DataValue,
  raw: string,
  inferred?: ColumnMeta["inferredType"],
): DataValue {
  if (v.kind !== "string") return v;
  if (!inferred || inferred === "string" || inferred === "mixed" || inferred === "unknown") {
    return v;
  }
  const classified = classifySample(raw);
  if (classified.kind === inferred) return classified;
  if (inferred === "decimal" && classified.kind === "integer") return classified;
  if (inferred === "datetime" && classified.kind === "date") return classified;
  return v;
}

export const defaultStore = new DatasetStore();
