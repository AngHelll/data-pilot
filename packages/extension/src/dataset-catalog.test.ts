import assert from "node:assert/strict";
import * as path from "node:path";
import test from "node:test";
import { DATASET_INDEX_LIMIT, datasetCatalog } from "./dataset-catalog.js";

test("the catalog keeps one path and includes a tab outside the workspace", () => {
  const listed = datasetCatalog({
    workspacePaths: ["/repo/fixtures/tiny.csv", "/repo/notes.md", "/repo/fixtures/tiny.csv"],
    tabPaths: ["/other/people.jsonl"],
    hitLimit: false,
  });
  assert.deepEqual(
    listed,
    [
      { kind: "file", filePath: path.resolve("/other/people.jsonl") },
      { kind: "file", filePath: path.resolve("/repo/fixtures/tiny.csv") },
    ],
  );
});

test("a full search adds a limit row after the files", () => {
  const workspacePaths = Array.from(
    { length: DATASET_INDEX_LIMIT },
    (_, index) => `/data/f${String(index).padStart(3, "0")}.csv`,
  );
  const listed = datasetCatalog({ workspacePaths, tabPaths: [], hitLimit: true });
  assert.equal(listed.length, DATASET_INDEX_LIMIT + 1);
  assert.equal(listed.at(-1)?.kind, "limit");
  assert.equal(listed.filter((entry) => entry.kind === "file").length, DATASET_INDEX_LIMIT);
});
