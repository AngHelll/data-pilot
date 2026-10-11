/** Visible slice of one loaded page. No vscode. */

export const ROW_HEIGHT_PX = 28;
export const ROW_OVERSCAN = 8;

export interface RowWindow {
  start: number;
  end: number;
  topPx: number;
  bottomPx: number;
}

const UNPAGED_QUERY = new Set(["count", "expectCount", "expectUnique", "whenExpect", "take"]);

export function previewCanPage(completion: string): boolean {
  return completion === "truncated" || completion === "partial";
}

export function queryStagesPage(stageKinds: readonly string[]): boolean {
  return !stageKinds.some((kind) => UNPAGED_QUERY.has(kind));
}

export function queryCanPage(stageKinds: readonly string[], completion: string): boolean {
  if (!previewCanPage(completion)) return false;
  return queryStagesPage(stageKinds);
}

export function rememberPageOffset(stack: readonly number[], offset: number): number[] {
  if (!Number.isInteger(offset) || offset < 0) return [...stack];
  if (stack.length === 0) return [offset];
  const current = stack[stack.length - 1] ?? 0;
  if (offset === current) return [...stack];
  if (stack.length > 1 && offset === stack[stack.length - 2]) return stack.slice(0, -1);
  return [...stack, offset];
}

export function visibleRowWindow(input: {
  rowCount: number;
  scrollTop: number;
  viewportHeight: number;
  rowHeight?: number;
  overscan?: number;
}): RowWindow {
  const rowHeight = input.rowHeight && input.rowHeight > 0 ? input.rowHeight : ROW_HEIGHT_PX;
  const overscan = input.overscan ?? ROW_OVERSCAN;
  const count = Number.isFinite(input.rowCount) ? Math.max(0, Math.floor(input.rowCount)) : 0;
  if (count === 0) return { start: 0, end: 0, topPx: 0, bottomPx: 0 };
  const scroll = Number.isFinite(input.scrollTop) ? Math.max(0, input.scrollTop) : 0;
  const view = Number.isFinite(input.viewportHeight) ? Math.max(rowHeight, input.viewportHeight) : rowHeight;
  const first = Math.floor(scroll / rowHeight);
  const visible = Math.max(1, Math.ceil(view / rowHeight));
  const start = Math.max(0, first - overscan);
  const end = Math.min(count, first + visible + overscan);
  return {
    start,
    end,
    topPx: start * rowHeight,
    bottomPx: Math.max(0, count - end) * rowHeight,
  };
}
