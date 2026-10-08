import assert from "node:assert/strict";
import * as path from "node:path";
import test from "node:test";
import { datasetTabPaths, isDatasetFilePath } from "./dataset-uri.js";

test("isDatasetFilePath recognizes supported extensions", () => {
  assert.equal(isDatasetFilePath("/tmp/x.csv"), true);
  assert.equal(isDatasetFilePath("/tmp/x.JSONL"), true);
  assert.equal(isDatasetFilePath("/tmp/x.ndjson"), true);
  assert.equal(isDatasetFilePath("/tmp/x.txt"), false);
});

test("datasetTabPaths keeps open dataset tabs and drops the rest", () => {
  assert.deepEqual(
    datasetTabPaths(["/tmp/tiny.csv", "/tmp/notes.txt", "/tmp/tiny.csv", "/tmp/people.jsonl"]),
    [path.resolve("/tmp/tiny.csv"), path.resolve("/tmp/people.jsonl")],
  );
});
