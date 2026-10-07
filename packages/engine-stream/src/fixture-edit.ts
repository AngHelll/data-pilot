import fs from "node:fs/promises";
import path from "node:path";
import { parse } from "csv-parse/sync";
import type { Diagnostic } from "@data-pilot/contracts";
import { DEFAULT_CSV_DIALECT } from "./csv.js";
import { serializeCsvMatrix } from "./csv-write.js";

export const DEFAULT_MAX_EDIT_BYTES = 2 * 1024 * 1024;

export interface CellEditTarget {
  filePath: string;
  format: "csv" | "jsonl";
  rowIndex: number;
  column: string;
  header: string[];
}

export interface EditPreview {
  path: string;
  rowIndex: number;
  column: string;
  oldRaw: string;
  newRaw: string;
  unifiedDiff: string;
  afterText: string;
}

function unifiedDiff(path: string, before: string, after: string): string {
  const bLines = before.split("\n");
  const aLines = after.split("\n");
  const out: string[] = [`--- a/${path}`, `+++ b/${path}`];
  const max = Math.max(bLines.length, aLines.length);
  let i = 0;
  while (i < max) {
    const bl = bLines[i];
    const al = aLines[i];
    if (bl === al) {
      i += 1;
      continue;
    }
    out.push(`@@ line ${i + 1} @@`);
    if (bl !== undefined) out.push(`- ${bl}`);
    if (al !== undefined) out.push(`+ ${al}`);
    i += 1;
    if (out.length > 200) {
      out.push("… (diff truncated)");
      break;
    }
  }
  return out.join("\n");
}

async function readTextBounded(filePath: string, maxBytes: number): Promise<string> {
  const stat = await fs.stat(filePath);
  if (stat.size > maxBytes) {
    throw editError(
      "edit-too-large",
      `File exceeds edit limit (${stat.size} B > ${maxBytes} B)`,
    );
  }
  return fs.readFile(filePath, "utf8");
}

function editError(code: string, message: string): Diagnostic & Error {
  return Object.assign(new Error(message), {
    code,
    severity: "error" as const,
    message,
  });
}

function loadCsvMatrix(text: string): { header: string[]; rows: string[][] } {
  const records = parse(text, {
    bom: true,
    relax_column_count: true,
    relax_quotes: DEFAULT_CSV_DIALECT.relaxQuotes,
    skip_empty_lines: DEFAULT_CSV_DIALECT.skipEmptyLines,
    delimiter: DEFAULT_CSV_DIALECT.delimiter,
    quote: DEFAULT_CSV_DIALECT.quote,
  }) as string[][];
  if (records.length === 0) {
    throw editError("empty-file", "CSV file has no rows");
  }
  const header = records[0]!.map(String);
  const rows = records.slice(1).map((r) => header.map((_, i) => String(r[i] ?? "")));
  return { header, rows };
}

function loadJsonlLines(text: string): string[] {
  const lines = text.split("\n");
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

export function buildEditPreview(
  target: CellEditTarget,
  beforeText: string,
  newRaw: string,
): EditPreview {
  const rel = path.basename(target.filePath);
  let afterText: string;
  let oldRaw: string;

  if (target.format === "csv") {
    const { header, rows } = loadCsvMatrix(beforeText);
    if (header.join("\0") !== target.header.join("\0")) {
      throw editError("header-changed", "CSV header changed since open; reopen the dataset");
    }
    const colIdx = header.indexOf(target.column);
    if (colIdx < 0) throw editError("unknown-column", `Unknown column '${target.column}'`);
    if (target.rowIndex < 0 || target.rowIndex >= rows.length) {
      throw editError("row-out-of-range", `Row index ${target.rowIndex} is out of range`);
    }
    oldRaw = rows[target.rowIndex]![colIdx] ?? "";
    rows[target.rowIndex]![colIdx] = newRaw;
    afterText = serializeCsvMatrix(header, rows);
  } else {
    const lines = loadJsonlLines(beforeText);
    if (target.rowIndex < 0 || target.rowIndex >= lines.length) {
      throw editError("row-out-of-range", `Row index ${target.rowIndex} is out of range`);
    }
    const line = lines[target.rowIndex]!;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line) as Record<string, unknown>;
    } catch {
      throw editError("invalid-jsonl", `Line ${target.rowIndex + 1} is not valid JSON`);
    }
    oldRaw = Object.prototype.hasOwnProperty.call(obj, target.column)
      ? String(obj[target.column])
      : "";
    obj[target.column] = newRaw;
    lines[target.rowIndex] = JSON.stringify(obj);
    afterText = lines.length > 0 ? `${lines.join("\n")}\n` : "";
  }

  return {
    path: target.filePath,
    rowIndex: target.rowIndex,
    column: target.column,
    oldRaw,
    newRaw,
    afterText,
    unifiedDiff: oldRaw === newRaw ? "" : unifiedDiff(rel, beforeText, afterText),
  };
}

export async function previewCellEdit(
  target: CellEditTarget,
  newRaw: string,
  maxBytes = DEFAULT_MAX_EDIT_BYTES,
): Promise<EditPreview> {
  const beforeText = await readTextBounded(target.filePath, maxBytes);
  return buildEditPreview(target, beforeText, newRaw);
}

/** Returns the text the host should write. Does not rename or modify the source file. */
export async function applyCellEdit(
  target: CellEditTarget,
  newRaw: string,
  maxBytes = DEFAULT_MAX_EDIT_BYTES,
): Promise<EditPreview> {
  return previewCellEdit(target, newRaw, maxBytes);
}
