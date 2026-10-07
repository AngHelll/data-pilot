import {
  type DataValue,
  type Diagnostic,
  booleanValue,
  decimalValue,
  integerValue,
  nullValue,
  stringValue,
} from "@data-pilot/contracts";

/** Default CSV null tokens (plan §7 #11 — settings vs sidecar still open). */
export const DEFAULT_NULL_TOKENS = new Set(["", "NULL", "null", "\\N", "NA", "N/A"]);

const INT_RE = /^-?\d+$/;
const DEC_RE = /^-?(?:\d+\.\d*|\d*\.\d+)(?:[eE][+-]?\d+)?$|^-?\d+[eE][+-]?\d+$/;
const BOOL_RE = /^(true|false)$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

export function tagCsvCell(
  raw: string | null | undefined,
  nullTokens: Set<string> = DEFAULT_NULL_TOKENS,
): DataValue {
  if (raw === null || raw === undefined) return nullValue();
  if (nullTokens.has(raw)) return nullValue();
  return stringValue(raw);
}

/** Promote a raw/string cell into a typed value for inference samples (does not mutate store). */
export function classifySample(raw: string): DataValue {
  if (DEFAULT_NULL_TOKENS.has(raw)) return nullValue();
  if (BOOL_RE.test(raw)) return booleanValue(raw.toLowerCase() === "true");
  if (INT_RE.test(raw)) return integerValue(raw);
  if (DEC_RE.test(raw)) return decimalValue(raw);
  if (DATE_RE.test(raw)) return { kind: "date", value: raw };
  if (DATETIME_RE.test(raw)) return { kind: "datetime", value: raw };
  return stringValue(raw);
}

/**
 * Tag a JSON value while preserving number exactness from the raw line when possible.
 * `rawNumber` is the original numeric token from the source line.
 */
export function tagJsonValue(
  value: unknown,
  rawNumber?: string,
): DataValue {
  if (value === null) return nullValue();
  if (typeof value === "boolean") return booleanValue(value);
  if (typeof value === "string") return stringValue(value);
  if (typeof value === "number") {
    if (rawNumber !== undefined) {
      if (INT_RE.test(rawNumber)) return integerValue(rawNumber);
      return decimalValue(rawNumber);
    }
    if (Number.isInteger(value) && Number.isSafeInteger(value)) {
      return integerValue(String(value));
    }
    return decimalValue(String(value));
  }
  // objects/arrays → JSON string for preview (not first-class in v0.1)
  return stringValue(JSON.stringify(value));
}

export function parseWarning(
  message: string,
  path?: string,
): Diagnostic {
  return {
    code: "parse-warning",
    severity: "warning",
    message,
    ...(path !== undefined ? { path } : {}),
  };
}
