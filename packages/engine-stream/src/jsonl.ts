import fs from "node:fs";
import readline from "node:readline";
import {
  type DataValue,
  type Diagnostic,
  missingValue,
} from "@data-pilot/contracts";
import { parseWarning, tagJsonValue } from "./cell.js";
import {
  createInferenceBuckets,
  finalizeColumns,
  observeValue,
} from "./infer.js";
import type { RowRecord, SampleResult } from "./csv.js";

const NUMBER_TOKEN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

/** Extract raw number tokens from a JSON object line for exact integer/decimal tagging. */
function extractNumberTokens(line: string): Map<string, string> {
  const map = new Map<string, string>();
  const re =
    /"([^"\\]|\\.)*"\s*:\s*(-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    const keyRaw = m[0].slice(0, m[0].indexOf(":"));
    const keyMatch = /"((?:[^"\\]|\\.)*)"/.exec(keyRaw);
    if (!keyMatch) continue;
    const key = JSON.parse(`"${keyMatch[1]}"`) as string;
    const num = m[2];
    if (num && NUMBER_TOKEN.test(num)) map.set(key, num);
  }
  return map;
}

function objectToRow(
  obj: Record<string, unknown>,
  columns: string[],
  numberTokens: Map<string, string>,
): { values: DataValue[]; raw: string[] } {
  const values: DataValue[] = [];
  const raw: string[] = [];
  for (const col of columns) {
    if (!Object.prototype.hasOwnProperty.call(obj, col)) {
      values.push(missingValue());
      raw.push("");
      continue;
    }
    const v = obj[col];
    const tagged = tagJsonValue(v, numberTokens.get(col));
    values.push(tagged);
    raw.push(
      v === null || v === undefined
        ? ""
        : typeof v === "string"
          ? v
          : typeof v === "number" || typeof v === "boolean"
            ? String(v)
            : JSON.stringify(v),
    );
  }
  return { values, raw };
}

export async function sampleJsonl(
  filePath: string,
  opts: {
    maxRows?: number;
    maxBytes?: number;
    signal?: AbortSignal;
  } = {},
): Promise<SampleResult> {
  const maxRows = opts.maxRows ?? 200;
  const maxBytes = opts.maxBytes ?? 1024 * 1024;
  const diagnostics: Diagnostic[] = [];
  const stream = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let bytesRead = 0;
  let truncated = false;
  const columnOrder: string[] = [];
  const columnSet = new Set<string>();
  const pending: Array<{
    obj: Record<string, unknown>;
    tokens: Map<string, string>;
    bytes: number;
  }> = [];

  // First pass within budget: discover columns from sample window, then materialize.
  try {
    for await (const line of rl) {
      if (opts.signal?.aborted) {
        truncated = true;
        break;
      }
      const trimmed = line.trim();
      const lineBytes = Buffer.byteLength(line, "utf8") + 1;
      bytesRead += lineBytes;
      if (trimmed === "") continue;

      let obj: unknown;
      try {
        obj = JSON.parse(trimmed);
      } catch {
        diagnostics.push(
          parseWarning(`Invalid JSONL at ~byte ${bytesRead}: ${trimmed.slice(0, 80)}`, filePath),
        );
        continue;
      }
      if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
        diagnostics.push(
          parseWarning("JSONL row must be a JSON object", filePath),
        );
        continue;
      }
      const rec = obj as Record<string, unknown>;
      for (const k of Object.keys(rec)) {
        if (!columnSet.has(k)) {
          columnSet.add(k);
          columnOrder.push(k);
        }
      }
      pending.push({
        obj: rec,
        tokens: extractNumberTokens(trimmed),
        bytes: lineBytes,
      });
      if (pending.length >= maxRows || bytesRead >= maxBytes) {
        truncated = true;
        break;
      }
    }
  } finally {
    rl.close();
    stream.destroy();
  }

  const buckets = createInferenceBuckets(columnOrder);
  const rows: RowRecord[] = [];
  for (const item of pending) {
    const { values, raw } = objectToRow(item.obj, columnOrder, item.tokens);
    for (let i = 0; i < values.length; i++) {
      observeValue(buckets[i]!, values[i]!);
      // observeValue already increments sampleSize — fix double count in observeValue usage
    }
    rows.push({ values, raw, byteLength: item.bytes });
  }

  // Fix double-count: observeValue increments sampleSize; we called it per cell once — OK.
  // But createInferenceBuckets + observeValue: good.

  return {
    columns: finalizeColumns(buckets),
    rows,
    diagnostics,
    bytesRead,
    truncated,
    header: columnOrder,
  };
}

export async function* iterateJsonlRows(
  filePath: string,
  columns: string[],
  opts: {
    signal?: AbortSignal;
    onBytes?: (n: number) => void;
  } = {},
): AsyncGenerator<{ values: DataValue[]; raw: string[]; bytes: number }, void, unknown> {
  const stream = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      if (opts.signal?.aborted) return;
      const trimmed = line.trim();
      const bytes = Buffer.byteLength(line, "utf8") + 1;
      opts.onBytes?.(bytes);
      if (trimmed === "") continue;
      let obj: unknown;
      try {
        obj = JSON.parse(trimmed);
      } catch {
        continue;
      }
      if (obj === null || typeof obj !== "object" || Array.isArray(obj)) continue;
      const rec = obj as Record<string, unknown>;
      const { values, raw } = objectToRow(rec, columns, extractNumberTokens(trimmed));
      yield { values, raw, bytes };
    }
  } finally {
    rl.close();
    stream.destroy();
  }
}
