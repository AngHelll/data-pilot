import path from "node:path";
import {
  DEFAULT_EXPORT_BUDGET,
  type Diagnostic,
  type ExportArtifact,
  type ExportFormat,
  type QueryBudget,
  type DataValue,
} from "@data-pilot/contracts";
import { serializeQueryResult, type DatasetStore } from "@data-pilot/engine-stream";
import { assertOpAllowed, type SessionContext } from "./trust.js";
import type { QueryService } from "./query-service.js";

export class ExportService {
  constructor(
    private readonly store: DatasetStore,
    private readonly queries: QueryService,
    private readonly ctx: SessionContext,
  ) {}

  async exportQueryResult(
    datasetId: string,
    dql: string,
    params?: Record<string, DataValue | string | number | boolean | null>,
    options: { format?: ExportFormat; budget?: QueryBudget } = {},
  ): Promise<ExportArtifact | Diagnostic> {
    const blocked = assertOpAllowed(this.ctx, "exportResult");
    if (blocked) return blocked;

    const { handle } = this.store.describe(datasetId);
    const sourceFormat = handle.format;
    const format =
      options.format === undefined || options.format === "same-as-source"
        ? sourceFormat
        : options.format;

    const budget: QueryBudget = {
      maxRows: options.budget?.maxRows ?? DEFAULT_EXPORT_BUDGET.maxRows,
      maxBytes: options.budget?.maxBytes ?? DEFAULT_EXPORT_BUDGET.maxBytes,
      ...(options.budget?.maxScanBytes !== undefined
        ? { maxScanBytes: options.budget.maxScanBytes }
        : {}),
      ...(options.budget?.wallClockMs !== undefined
        ? { wallClockMs: options.budget.wallClockMs }
        : {}),
    };

    const result = await this.queries.execute(
      datasetId,
      dql,
      params,
      budget,
      "export",
    );

    const errors = result.diagnostics.filter((d) => d.severity === "error");
    if (result.completion === "error" || errors.length > 0) {
      return {
        code: "export-query-failed",
        severity: "error",
        message: errors[0]?.message ?? "Query failed; nothing exported",
        related: result.diagnostics.map((d) => ({ message: d.message })),
      };
    }

    if (result.rowCountReturned === 0) {
      return {
        code: "export-empty",
        severity: "error",
        message: "Query returned zero rows; nothing exported",
      };
    }

    const content = serializeQueryResult(
      format,
      result.columns,
      result.rows,
    );
    const ext = format === "jsonl" ? ".jsonl" : ".csv";
    const stem = path.basename(handle.revision.path, path.extname(handle.revision.path));

    return {
      format,
      content,
      byteLength: Buffer.byteLength(content, "utf8"),
      rowCount: result.rowCountReturned,
      suggestedBasename: `${stem}-export${ext}`,
      completion: result.completion,
      diagnostics: result.diagnostics,
    };
  }
}
