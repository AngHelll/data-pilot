import type { KeyDiffResult, QueryBudget } from "@data-pilot/contracts";
import { DatasetStore, compareByKey } from "@data-pilot/engine-stream";
import { assertOpAllowed, type SessionContext } from "./trust.js";

export class CompareService {
  constructor(
    private readonly store: DatasetStore,
    private readonly ctx: SessionContext,
  ) {}

  async compare(
    leftId: string,
    rightId: string,
    column: string,
    budget?: QueryBudget,
  ): Promise<KeyDiffResult> {
    const blocked = assertOpAllowed(this.ctx, "compareDatasets");
    if (blocked) throw blocked;
    return compareByKey(this.store, leftId, rightId, column, budget);
  }
}
