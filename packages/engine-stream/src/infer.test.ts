import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DataValue } from "@data-pilot/contracts";
import { createInferenceBuckets, finalizeColumns, observeValue } from "./infer.js";

function column(values: DataValue[]) {
  const [bucket] = createInferenceBuckets(["col"]);
  for (const value of values) observeValue(bucket!, value);
  return finalizeColumns([bucket!])[0]!;
}

describe("sample profile", () => {
  it("counts distinct concrete values and ignores null and missing", () => {
    const col = column([
      { kind: "string", value: "MX" },
      { kind: "null" },
      { kind: "string", value: "US" },
      { kind: "missing" },
      { kind: "string", value: "MX" },
    ]);
    assert.equal(col.distinctCountSample, 2);
    assert.equal(col.nullCountSample, 1);
    assert.equal(col.missingCountSample, 1);
    assert.equal(col.minSample, undefined);
    assert.equal(col.maxSample, undefined);
  });

  it("counts an empty string when it is classified as a value", () => {
    const col = column([
      { kind: "string", value: "" },
      { kind: "string", value: "MX" },
    ]);
    assert.equal(col.distinctCountSample, 2);
  });

  it("orders numeric min and max so 9 comes before 10", () => {
    const col = column([
      { kind: "integer", value: "10" },
      { kind: "integer", value: "9" },
      { kind: "integer", value: "10" },
    ]);
    assert.equal(col.inferredType, "integer");
    assert.equal(col.distinctCountSample, 2);
    assert.equal(col.minSample, "9");
    assert.equal(col.maxSample, "10");
  });

  it("keeps min and max when integers and decimals infer as decimal", () => {
    const col = column([
      { kind: "integer", value: "10" },
      { kind: "decimal", value: "9.5" },
    ]);
    assert.equal(col.inferredType, "decimal");
    assert.equal(col.minSample, "9.5");
    assert.equal(col.maxSample, "10");
  });

  it("omits min and max for string, boolean, date, and mixed", () => {
    const stringCol = column([{ kind: "string", value: "10" }]);
    const boolCol = column([{ kind: "boolean", value: false }]);
    const dateCol = column([{ kind: "date", value: "2020-01-02" }]);
    const mixed = column([
      { kind: "integer", value: "1" },
      { kind: "string", value: "a" },
    ]);
    for (const col of [stringCol, boolCol, dateCol, mixed]) {
      assert.equal(col.minSample, undefined);
      assert.equal(col.maxSample, undefined);
    }
    assert.equal(mixed.inferredType, "mixed");
    assert.equal(mixed.distinctCountSample, 2);
  });

  it("reports distinct 0 and no min or max when the sample is empty", () => {
    const [bucket] = createInferenceBuckets(["col"]);
    const col = finalizeColumns([bucket!])[0]!;
    assert.equal(col.sampleSize, 0);
    assert.equal(col.distinctCountSample, 0);
    assert.equal(col.minSample, undefined);
    assert.equal(col.maxSample, undefined);
  });
});
