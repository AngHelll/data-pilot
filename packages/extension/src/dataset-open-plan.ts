import * as path from "node:path";

export type DatasetTabKind = "text" | "data-pilot" | "other";

/** One open tab the host already classified. No vscode. */
export interface DatasetOpenTab {
  kind: DatasetTabKind;
  matchesFile: boolean;
  active: boolean;
  groupIndex: number;
  tabIndex: number;
}

export type DatasetOpenPlan =
  | { action: "focus"; groupIndex: number; tabIndex: number }
  | {
      action: "replace-text";
      close: { groupIndex: number; tabIndex: number }[];
      groupIndex: number;
    }
  | { action: "open-new" };

/**
 * One Data Pilot tab is focused.
 * Text tabs of that file are replaced only when no Data Pilot tab exists.
 */
export function datasetOpenPlan(tabs: readonly DatasetOpenTab[]): DatasetOpenPlan {
  const pilot = tabs.find((tab) => tab.matchesFile && tab.kind === "data-pilot");
  if (pilot) return { action: "focus", groupIndex: pilot.groupIndex, tabIndex: pilot.tabIndex };

  const texts = tabs.filter((tab) => tab.matchesFile && tab.kind === "text");
  if (texts.length === 0) return { action: "open-new" };

  const active = texts.find((tab) => tab.active) ?? texts[0]!;
  return {
    action: "replace-text",
    close: texts.map((tab) => ({ groupIndex: tab.groupIndex, tabIndex: tab.tabIndex })),
    groupIndex: active.groupIndex,
  };
}

export type DatasetRowState = "idle" | "open" | "warning";

/** Icon color for a catalog row. Info and hint stay on the open color. */
export function datasetRowState(input: {
  open: boolean;
  diagnostics: readonly { severity: string }[];
}): DatasetRowState {
  if (!input.open) return "idle";
  const warned = input.diagnostics.some(
    (item) => item.severity === "error" || item.severity === "warning",
  );
  return warned ? "warning" : "open";
}

export function datasetFormatIcon(filePath: string): "table" | "json" {
  return path.extname(filePath).toLowerCase() === ".csv" ? "table" : "json";
}

export function datasetRowColor(
  state: DatasetRowState,
): "charts.green" | "charts.orange" | undefined {
  if (state === "open") return "charts.green";
  if (state === "warning") return "charts.orange";
  return undefined;
}
