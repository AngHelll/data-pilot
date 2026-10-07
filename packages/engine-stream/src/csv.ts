import fs from "node:fs";
import { parse } from "csv-parse";
import type { DataValue, Diagnostic } from "@data-pilot/contracts";
import { DEFAULT_NULL_TOKENS, parseWarning, tagCsvCell } from "./cell.js";
import {
  createInferenceBuckets,
  finalizeColumns,
  observeRaw,
} from "./infer.js";

export interface CsvDialect {
  delimiter: string;
  quote: string;
  relaxQuotes: boolean;
  skipEmptyLines: boolean;
}

export const DEFAULT_CSV_DIALECT: CsvDialect = {
  delimiter: ",",
  quote: '"',
  relaxQuotes: true,
  skipEmptyLines: true,
};

export interface RowRecord {
  values: DataValue[];
  raw: string[];
  byteLength: number;
}

export interface SampleResult {
  columns: ReturnType<typeof finalizeColumns>;
  rows: RowRecord[];
  diagnostics: Diagnostic[];
  bytesRead: number;
  truncated: boolean;
  header: string[];
}

export async function sampleCsv(
  filePath: string,
  opts: {
    maxRows?: number;
    maxBytes?: number;
    dialect?: Partial<CsvDialect>;
    nullTokens?: Set<string>;
    signal?: AbortSignal;
  } = {},
): Promise<SampleResult> {
  const maxRows = opts.maxRows ?? 200;
  const maxBytes = opts.maxBytes ?? 1024 * 1024;
  const dialect = { ...DEFAULT_CSV_DIALECT, ...opts.dialect };
  const nullTokens = opts.nullTokens ?? DEFAULT_NULL_TOKENS;
  const diagnostics: Diagnostic[] = [];

  const stream = fs.createReadStream(filePath);
  let bytesRead = 0;
  stream.on("data", (chunk: string | Buffer) => {
    bytesRead += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk);
  });

  const parser = stream.pipe(
    parse({
      bom: true,
      columns: false,
      relax_column_count: true,
      relax_quotes: dialect.relaxQuotes,
      skip_empty_lines: dialect.skipEmptyLines,
      delimiter: dialect.delimiter,
      quote: dialect.quote,
    }),
  );

  let header: string[] | null = null;
  const rows: RowRecord[] = [];
  let buckets = createInferenceBuckets([]);
  let truncated = false;
  let rowIndex = 0;

  try {
    for await (const record of parser as AsyncIterable<string[]>) {
      if (opts.signal?.aborted) {
        truncated = true;
        break;
      }

      if (!header) {
        header = record.map((h, i) => {
          const trimmed = h.trim();
          return trimmed === "" ? `column_${i + 1}` : trimmed;
        });
        const seen = new Set<string>();
        header = header.map((h, i) => {
          let name = h;
          if (seen.has(name)) {
            name = `${h}_${i + 1}`;
            diagnostics.push(
              parseWarning(`Duplicate header '${h}' renamed to '${name}'`, filePath),
            );
          }
          seen.add(name);
          return name;
        });
        buckets = createInferenceBuckets(header);
        continue;
      }

      if (rows.length >= maxRows || bytesRead >= maxBytes) {
        truncated = true;
        break;
      }

      if (record.length !== header.length) {
        diagnostics.push(
          parseWarning(
            `Row ${rowIndex + 1}: expected ${header.length} fields, got ${record.length}`,
            filePath,
          ),
        );
      }

      const raw = header.map((_, i) => record[i] ?? "");
      const values = raw.map((c) => tagCsvCell(c, nullTokens));
      for (let i = 0; i < header.length; i++) {
        observeRaw(buckets[i]!, raw[i]);
      }
      const lineBytes = Buffer.byteLength(raw.join(dialect.delimiter), "utf8") + 1;
      rows.push({ values, raw, byteLength: lineBytes });
      rowIndex += 1;
    }
  } finally {
    stream.destroy();
  }

  if (!header) {
    return {
      columns: [],
      rows: [],
      diagnostics: [
        {
          code: "empty-dataset",
          severity: "error",
          message: "CSV file has no header row",
          path: filePath,
        },
      ],
      bytesRead,
      truncated: false,
      header: [],
    };
  }

  return {
    columns: finalizeColumns(buckets),
    rows,
    diagnostics,
    bytesRead,
    truncated,
    header,
  };
}

export async function* iterateCsvRows(
  filePath: string,
  header: string[],
  opts: {
    dialect?: Partial<CsvDialect>;
    nullTokens?: Set<string>;
    signal?: AbortSignal;
    onBytes?: (n: number) => void;
  } = {},
): AsyncGenerator<{ values: DataValue[]; raw: string[]; bytes: number }, void, unknown> {
  const dialect = { ...DEFAULT_CSV_DIALECT, ...opts.dialect };
  const nullTokens = opts.nullTokens ?? DEFAULT_NULL_TOKENS;
  const stream = fs.createReadStream(filePath);
  stream.on("data", (chunk: string | Buffer) => {
    const n = Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk);
    opts.onBytes?.(n);
  });

  const parser = stream.pipe(
    parse({
      bom: true,
      columns: false,
      relax_column_count: true,
      relax_quotes: dialect.relaxQuotes,
      skip_empty_lines: dialect.skipEmptyLines,
      delimiter: dialect.delimiter,
      quote: dialect.quote,
    }),
  );

  let skippedHeader = false;
  try {
    for await (const record of parser as AsyncIterable<string[]>) {
      if (opts.signal?.aborted) return;
      if (!skippedHeader) {
        skippedHeader = true;
        continue;
      }
      const raw = header.map((_, i) => record[i] ?? "");
      const values = raw.map((c) => tagCsvCell(c, nullTokens));
      yield {
        values,
        raw,
        bytes: Buffer.byteLength(raw.join(dialect.delimiter), "utf8") + 1,
      };
    }
  } finally {
    stream.destroy();
  }
}
