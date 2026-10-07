import assert from "node:assert/strict";
import test from "node:test";
import { isDatasetFilePath } from "./dataset-uri.js";

test("isDatasetFilePath recognizes supported extensions", () => {
  assert.equal(isDatasetFilePath("/tmp/x.csv"), true);
  assert.equal(isDatasetFilePath("/tmp/x.JSONL"), true);
  assert.equal(isDatasetFilePath("/tmp/x.ndjson"), true);
  assert.equal(isDatasetFilePath("/tmp/x.txt"), false);
});
