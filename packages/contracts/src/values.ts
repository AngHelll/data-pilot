import type { DataValue, InferredType } from "./index.js";

export function nullValue(): DataValue {
  return { kind: "null" };
}

export function missingValue(): DataValue {
  return { kind: "missing" };
}

export function stringValue(value: string): DataValue {
  return { kind: "string", value };
}

export function booleanValue(value: boolean): DataValue {
  return { kind: "boolean", value };
}

export function integerValue(value: string): DataValue {
  return { kind: "integer", value };
}

export function decimalValue(value: string): DataValue {
  return { kind: "decimal", value };
}

export function isConcrete(v: DataValue): boolean {
  return (
    v.kind === "string" ||
    v.kind === "boolean" ||
    v.kind === "integer" ||
    v.kind === "decimal" ||
    v.kind === "date" ||
    v.kind === "datetime"
  );
}

/** Display / find stringify — never HTML. */
export function valueToSearchText(v: DataValue): string | null {
  switch (v.kind) {
    case "null":
    case "missing":
      return null;
    case "string":
      return v.value;
    case "boolean":
      return v.value ? "true" : "false";
    case "integer":
    case "decimal":
    case "date":
    case "datetime":
      return v.value;
  }
}

export function inferredTypeOf(v: DataValue): InferredType | null {
  if (v.kind === "null" || v.kind === "missing") return null;
  return v.kind;
}
