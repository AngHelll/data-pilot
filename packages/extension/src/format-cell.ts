import { type DataValue, valueToSearchText } from "@data-pilot/contracts";

/** Plain-text cell rendering for webview tables (never HTML). */
export function formatCell(v: DataValue): string {
  if (v.kind === "null") return "null";
  if (v.kind === "missing") return "·";
  return valueToSearchText(v) ?? "";
}

export function formatCells(rows: DataValue[][]): string[][] {
  return rows.map((row) => row.map(formatCell));
}
