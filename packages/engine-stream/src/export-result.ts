import type { DataValue } from "@data-pilot/contracts";
import { valueToSearchText } from "@data-pilot/contracts";
import { serializeCsvMatrix } from "./csv-write.js";

export function dataValueToExportCell(v: DataValue): string {
  if (v.kind === "null" || v.kind === "missing") return "";
  return valueToSearchText(v) ?? "";
}

function dataValueToJsonField(v: DataValue): unknown {
  switch (v.kind) {
    case "null":
      return null;
    case "missing":
      return null;
    case "string":
      return v.value;
    case "boolean":
      return v.value;
    case "integer": {
      const n = Number(v.value);
      return Number.isSafeInteger(n) ? n : v.value;
    }
    case "decimal": {
      const n = Number(v.value);
      return Number.isFinite(n) ? n : v.value;
    }
    case "date":
    case "datetime":
      return v.value;
  }
}

export function serializeQueryResult(
  format: "csv" | "jsonl",
  columns: string[],
  rows: DataValue[][],
): string {
  if (format === "jsonl") {
    const lines = rows.map((row) => {
      const obj: Record<string, unknown> = {};
      for (let i = 0; i < columns.length; i++) {
        const col = columns[i]!;
        const v = row[i];
        if (v === undefined || v.kind === "missing") continue;
        obj[col] = dataValueToJsonField(v);
      }
      return JSON.stringify(obj);
    });
    return lines.length > 0 ? `${lines.join("\n")}\n` : "";
  }
  const matrix = rows.map((row) => columns.map((_, i) => dataValueToExportCell(row[i]!)));
  return serializeCsvMatrix(columns, matrix);
}
