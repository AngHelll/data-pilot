import assert from "node:assert/strict";
import test from "node:test";
import { integerValue, missingValue, nullValue, stringValue } from "@data-pilot/contracts";
import { serializeQueryResult } from "./export-result.js";

test("serializeQueryResult emits CSV with header", () => {
  const csv = serializeQueryResult(
    "csv",
    ["id", "name"],
    [[integerValue("1"), stringValue("Ada")]],
  );
  assert.match(csv, /^id,name/);
  assert.match(csv, /1,Ada/);
});

test("serializeQueryResult emits JSONL objects", () => {
  const jsonl = serializeQueryResult(
    "jsonl",
    ["id", "note"],
    [[integerValue("1"), missingValue()]],
  );
  const row = JSON.parse(jsonl.trim()) as Record<string, unknown>;
  assert.equal(row.id, 1);
  assert.equal("note" in row, false);
});
