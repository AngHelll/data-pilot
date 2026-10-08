import assert from "node:assert/strict";
import test from "node:test";
import { datasetTreePresentation } from "./dataset-tree-presentation.js";

test("a dataset row shows the file name and keeps the id in the tooltip", () => {
  const shown = datasetTreePresentation("/data/tiny.csv", "6f0c2a1b-dataset");
  assert.equal(shown.label, "tiny.csv");
  assert.equal(shown.description, "");
  assert.equal(shown.tooltip, "/data/tiny.csv\n6f0c2a1b-dataset");
  assert.equal(shown.description.includes("6f0c2a1b-dataset"), false);
});
