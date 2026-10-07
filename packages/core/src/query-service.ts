import {
  type DataValue,
  type Diagnostic,
  type QueryBudget,
  type QueryResult,
  type SavedQuery,
  type TrustMode,
} from "@data-pilot/contracts";
import { analyzeDql, formatDql, type DqlQuery } from "@data-pilot/dql";
import { executeDql, type DatasetStore } from "@data-pilot/engine-stream";
import { normalizeParams } from "./params.js";
import { assertOpAllowed, type SessionContext } from "./trust.js";

export interface PlanResult {
  query?: DqlQuery;
  formatted?: string;
  diagnostics: Diagnostic[];
}

export class QueryService {
  constructor(
    private readonly store: DatasetStore,
    private readonly trustMode: TrustMode = "trusted",
  ) {}

  private ctx(): SessionContext {
    return { trustMode: this.trustMode };
  }

  plan(
    datasetId: string,
    dql: string,
    params?: Record<string, DataValue | string | number | boolean | null>,
  ): PlanResult {
    const blocked = assertOpAllowed(this.ctx(), "planQuery");
    if (blocked) return { diagnostics: [blocked] };

    const { handle } = this.store.describe(datasetId);
    const normalized = normalizeParams(params);
    const analyzed = analyzeDql(dql, handle.columns, normalized);
    if (!analyzed.query) return { diagnostics: analyzed.diagnostics };
    return {
      query: analyzed.query,
      formatted: formatDql(analyzed.query),
      diagnostics: analyzed.diagnostics,
    };
  }

  async execute(
    datasetId: string,
    dql: string,
    params?: Record<string, DataValue | string | number | boolean | null>,
    budget: QueryBudget = {},
    requestId = "query",
    signal?: AbortSignal,
  ): Promise<QueryResult> {
    const blocked = assertOpAllowed(this.ctx(), "executeQuery");
    if (blocked) {
      const { handle } = this.store.describe(datasetId);
      return {
        requestId,
        datasetId,
        revisionId: handle.revision.revisionId,
        columns: [],
        rows: [],
        rowCountReturned: 0,
        completion: "error",
        scope: "unknown",
        diagnostics: [blocked],
      };
    }

    const { handle } = this.store.describe(datasetId);
    const normalized = normalizeParams(params);
    const analyzed = analyzeDql(dql, handle.columns, normalized);
    const errors = analyzed.diagnostics.filter((d) => d.severity === "error");
    if (!analyzed.query || errors.length > 0) {
      return {
        requestId,
        datasetId,
        revisionId: handle.revision.revisionId,
        columns: handle.columns.map((c) => c.name),
        rows: [],
        rowCountReturned: 0,
        completion: "error",
        scope: "unknown",
        diagnostics: analyzed.diagnostics,
      };
    }

    return executeDql(
      this.store,
      datasetId,
      analyzed.query,
      normalized,
      budget,
      requestId,
      signal,
    );
  }

  /** Validates DQL (parse + typecheck) before returning a portable SavedQuery DTO. */
  saveQuery(
    datasetId: string,
    dql: string,
    params?: Record<string, DataValue | string | number | boolean | null>,
  ): SavedQuery | Diagnostic {
    const blocked = assertOpAllowed(this.ctx(), "saveQuery");
    if (blocked) return blocked;

    const plan = this.plan(datasetId, dql, params);
    const errors = plan.diagnostics.filter((d) => d.severity === "error");
    if (!plan.query || errors.length > 0) {
      return (
        errors[0] ?? {
          code: "invalid-query",
          severity: "error",
          message: "Query is not valid; fix DQL before saving",
        }
      );
    }

    const { handle } = this.store.describe(datasetId);
    const normalized = normalizeParams(params);
    return {
      dqlVersion: "0.1",
      dql: plan.formatted ?? dql.trim(),
      ...(Object.keys(normalized).length > 0 ? { params: normalized } : {}),
      schemaColumnNames: handle.columns.map((c) => c.name),
      savedAtMs: Date.now(),
    };
  }

  /** @deprecated Use saveQuery — kept for tests migrating gradually. */
  saveQueryDraft(
    dql: string,
    datasetId: string,
    params?: Record<string, DataValue>,
  ): SavedQuery | Diagnostic {
    return this.saveQuery(datasetId, dql, params);
  }
}
