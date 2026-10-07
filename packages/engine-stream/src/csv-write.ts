import { DEFAULT_CSV_DIALECT } from "./csv.js";

export function escapeCsvField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Serialize a header row + data rows to CSV text (UTF-8, trailing newline). */
export function serializeCsvMatrix(header: string[], rows: string[][]): string {
  const lines = [header, ...rows].map((row) =>
    row.map(escapeCsvField).join(DEFAULT_CSV_DIALECT.delimiter),
  );
  return `${lines.join("\n")}\n`;
}
