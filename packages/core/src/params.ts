import {
  type DataValue,
  booleanValue,
  decimalValue,
  integerValue,
  nullValue,
  stringValue,
} from "@data-pilot/contracts";

/** Normalize CLI/IPC param bindings into tagged DataValues. */
export function normalizeParams(
  params: Record<string, DataValue | string | number | boolean | null> | undefined,
): Record<string, DataValue> {
  if (!params) return {};
  const out: Record<string, DataValue> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v === null) {
      out[k] = nullValue();
      continue;
    }
    if (typeof v === "object" && v !== null && "kind" in v) {
      out[k] = v;
      continue;
    }
    if (typeof v === "boolean") {
      out[k] = booleanValue(v);
      continue;
    }
    if (typeof v === "number") {
      out[k] = Number.isInteger(v)
        ? integerValue(String(v))
        : decimalValue(String(v));
      continue;
    }
    if (typeof v === "string") {
      if (/^-?\d+$/.test(v)) out[k] = integerValue(v);
      else if (/^-?(?:\d+\.\d*|\d*\.\d+)(?:[eE][+-]?\d+)?$/.test(v)) out[k] = decimalValue(v);
      else out[k] = stringValue(v);
      continue;
    }
    out[k] = stringValue(String(v));
  }
  return out;
}
