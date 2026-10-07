import {
  type Diagnostic,
  type EngineOp,
  type QueryBudget,
  type QueryResult,
  type TrustMode,
} from "@data-pilot/contracts";
import { DatasetStore, type OpenOptions } from "@data-pilot/engine-stream";
import { assertOpAllowed, type SessionContext } from "./trust.js";

export class DatasetService {
  constructor(
    private readonly store: DatasetStore,
    private readonly trustMode: TrustMode = "trusted",
  ) {}

  private ctx(): SessionContext {
    return { trustMode: this.trustMode };
  }

  private gate(op: EngineOp): Diagnostic | null {
    return assertOpAllowed(this.ctx(), op);
  }

  async open(path: string, options?: OpenOptions) {
    const blocked = this.gate("openDataset");
    if (blocked) throw blocked;
    return this.store.open(path, options);
  }

  describe(datasetId: string) {
    const blocked = this.gate("describeDataset");
    if (blocked) throw blocked;
    return this.store.describe(datasetId);
  }

  async preview(datasetId: string, budget?: QueryBudget, requestId?: string, signal?: AbortSignal) {
    const blocked = this.gate("preview");
    if (blocked) throw blocked;
    return this.store.preview(datasetId, budget, requestId, signal);
  }

  async inspect(datasetId: string, rowIndex: number, column: string) {
    const blocked = this.gate("inspectValue");
    if (blocked) throw blocked;
    return this.store.inspect(datasetId, rowIndex, column);
  }

  close(datasetId: string) {
    const blocked = this.gate("closeDataset");
    if (blocked) throw blocked;
    this.store.close(datasetId);
  }

  /** Underlying store for query execution (same process). */
  getStore(): DatasetStore {
    return this.store;
  }
}

export function isDiagnostic(err: unknown): err is Diagnostic {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    "severity" in err &&
    "message" in err
  );
}

export type { QueryResult };
