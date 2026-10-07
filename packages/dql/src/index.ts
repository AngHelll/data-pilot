/**
 * DQL 0.1 — tokenizer, parser, typecheck, formatter.
 * No filesystem or VS Code imports.
 */

export const DQL_VERSION = "0.1" as const;

export type {
  CaseMode,
  DqlQuery,
  Expr,
  Predicate,
  Span,
  Stage,
} from "./ast.js";

export { parseDql, ParseError } from "./parse.js";
export { tokenize, TokenizeError, type Token } from "./tokenize.js";
export { typecheck, type TypecheckResult } from "./typecheck.js";
export { formatDql } from "./format.js";

import type { ColumnMeta, DataValue, Diagnostic } from "@data-pilot/contracts";
import { parseDql, ParseError } from "./parse.js";
import { typecheck } from "./typecheck.js";
import type { DqlQuery } from "./ast.js";

export interface AnalyzeResult {
  query?: DqlQuery;
  diagnostics: Diagnostic[];
}

/** Parse + typecheck in one step. */
export function analyzeDql(
  source: string,
  columns: ColumnMeta[],
  params: Record<string, DataValue | undefined> = {},
): AnalyzeResult {
  try {
    const query = parseDql(source);
    const { diagnostics } = typecheck(query, columns, params);
    return { query, diagnostics };
  } catch (err) {
    if (err instanceof ParseError) {
      return {
        diagnostics: [
          {
            code: err.code,
            severity: "error",
            message: err.message,
            range: err.span,
          },
        ],
      };
    }
    throw err;
  }
}
