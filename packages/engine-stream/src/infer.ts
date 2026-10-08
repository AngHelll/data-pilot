import type { ColumnMeta, DataValue, InferredType } from "@data-pilot/contracts";
import { classifySample } from "./cell.js";
import { cmpValues } from "./execute.js";

type Bucket = {
  name: string;
  kinds: Set<InferredType>;
  nullCount: number;
  missingCount: number;
  sampleSize: number;
  distinct: Set<string>;
  minNumeric?: DataValue;
  maxNumeric?: DataValue;
};

export function createInferenceBuckets(names: string[]): Bucket[] {
  return names.map((name) => ({
    name,
    kinds: new Set(),
    nullCount: 0,
    missingCount: 0,
    sampleSize: 0,
    distinct: new Set(),
  }));
}

export function observeRaw(bucket: Bucket, raw: string | null | undefined): void {
  if (raw === null || raw === undefined) {
    observeValue(bucket, { kind: "null" });
    return;
  }
  observeValue(bucket, classifySample(raw));
}

export function observeValue(bucket: Bucket, v: DataValue): void {
  bucket.sampleSize += 1;
  if (v.kind === "null") {
    bucket.nullCount += 1;
    return;
  }
  if (v.kind === "missing") {
    bucket.missingCount += 1;
    return;
  }
  bucket.kinds.add(v.kind);
  bucket.distinct.add(JSON.stringify(v));
  if (v.kind === "integer" || v.kind === "decimal") {
    if (!bucket.minNumeric || cmpValues("<", v, bucket.minNumeric) === true) {
      bucket.minNumeric = v;
    }
    if (!bucket.maxNumeric || cmpValues(">", v, bucket.maxNumeric) === true) {
      bucket.maxNumeric = v;
    }
  }
}

export function finalizeColumns(buckets: Bucket[]): ColumnMeta[] {
  return buckets.map((b) => {
    const kinds = [...b.kinds];
    let inferredType: InferredType = "unknown";
    if (kinds.length === 0) {
      inferredType = b.sampleSize === 0 ? "unknown" : "unknown";
    } else if (kinds.length === 1) {
      inferredType = kinds[0]!;
    } else if (
      kinds.every((k) => k === "integer" || k === "decimal") &&
      kinds.includes("decimal")
    ) {
      inferredType = "decimal";
    } else if (kinds.every((k) => k === "date" || k === "datetime")) {
      inferredType = "datetime";
    } else {
      inferredType = "mixed";
    }

    const numeric = inferredType === "integer" || inferredType === "decimal";
    const min =
      numeric && b.minNumeric && (b.minNumeric.kind === "integer" || b.minNumeric.kind === "decimal")
        ? b.minNumeric.value
        : undefined;
    const max =
      numeric && b.maxNumeric && (b.maxNumeric.kind === "integer" || b.maxNumeric.kind === "decimal")
        ? b.maxNumeric.value
        : undefined;

    return {
      name: b.name,
      inferredType,
      nullCountSample: b.nullCount,
      missingCountSample: b.missingCount,
      sampleSize: b.sampleSize,
      distinctCountSample: b.distinct.size,
      ...(min !== undefined ? { minSample: min } : {}),
      ...(max !== undefined ? { maxSample: max } : {}),
    };
  });
}
