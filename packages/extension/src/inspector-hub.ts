/** The cell the external inspector is showing. No vscode. */

export interface InspectorCell {
  filePath: string;
  fileName: string;
  rowIndex: number;
  column: string;
  inferredType: string;
  raw: string;
  canEdit: boolean;
}

export type InspectorEvent =
  | { type: "cell"; cell: InspectorCell }
  | { type: "empty" }
  | { type: "diff"; diff: string }
  | { type: "notice"; message: string };

type Sink = (event: InspectorEvent) => void;

let sink: Sink | undefined;
let hosted = false;

export function setInspectorSink(next: Sink | undefined): void {
  sink = next;
}

export function emitInspector(event: InspectorEvent): void {
  sink?.(event);
}

export function setInspectorHosted(next: boolean): void {
  hosted = next;
}

export function inspectorIsHosted(): boolean {
  return hosted;
}
