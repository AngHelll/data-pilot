import type { Diagnostic } from "@data-pilot/contracts";
import { DatasetStore } from "@data-pilot/engine-stream";
import type { EditPreview } from "@data-pilot/engine-stream";
import { assertOpAllowed, type SessionContext } from "./trust.js";

export class EditService {
  constructor(
    private readonly store: DatasetStore,
    private readonly ctx: SessionContext,
  ) {}

  private gate(): Diagnostic | null {
    return assertOpAllowed(this.ctx, "editFixture");
  }

  async preview(
    datasetId: string,
    rowIndex: number,
    column: string,
    newRaw: string,
  ): Promise<EditPreview> {
    const blocked = this.gate();
    if (blocked) throw blocked;
    return this.store.previewCellEdit(datasetId, rowIndex, column, newRaw);
  }

  async apply(
    datasetId: string,
    rowIndex: number,
    column: string,
    newRaw: string,
  ): Promise<EditPreview> {
    const blocked = this.gate();
    if (blocked) throw blocked;
    return this.store.applyCellEdit(datasetId, rowIndex, column, newRaw);
  }
}
