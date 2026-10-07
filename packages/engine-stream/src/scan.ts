import fs from "node:fs";
import readline from "node:readline";

export interface ScanPreviewResult {
  rows: string[][];
  bytesRead: number;
  truncated: boolean;
  header: string[];
}

/**
 * Bounded CSV preview: reads until maxRows or maxBytes, whichever first.
 * Not a full CSV parser (quotes/multiline deferred to Phase 1).
 */
export async function scanPreview(
  filePath: string,
  opts: { maxRows?: number; maxBytes?: number } = {},
): Promise<ScanPreviewResult> {
  const maxRows = opts.maxRows ?? 200;
  const maxBytes = opts.maxBytes ?? 1024 * 1024;
  const stream = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let bytesRead = 0;
  let truncated = false;
  const rows: string[][] = [];
  let header: string[] = [];

  for await (const line of rl) {
    bytesRead += Buffer.byteLength(line, "utf8") + 1;
    if (header.length === 0) {
      header = line.split(",");
      continue;
    }
    if (rows.length >= maxRows || bytesRead >= maxBytes) {
      truncated = true;
      break;
    }
    rows.push(line.split(","));
  }
  rl.close();
  stream.destroy();
  return { rows, bytesRead, truncated, header };
}

/** Full line count with cooperative abort via AbortSignal. */
export async function countLines(
  filePath: string,
  signal?: AbortSignal,
): Promise<{ lines: number; bytesRead: number; cancelled: boolean }> {
  const stream = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let lines = 0;
  let bytesRead = 0;
  let cancelled = false;

  try {
    for await (const line of rl) {
      if (signal?.aborted) {
        cancelled = true;
        break;
      }
      lines += 1;
      bytesRead += Buffer.byteLength(line, "utf8") + 1;
    }
  } finally {
    rl.close();
    stream.destroy();
  }
  return { lines, bytesRead, cancelled };
}
