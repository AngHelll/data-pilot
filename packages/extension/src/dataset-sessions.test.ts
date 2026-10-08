import assert from "node:assert/strict";
import * as path from "node:path";
import { describe, it } from "node:test";
import { DatasetSessionRegistry } from "./dataset-sessions.js";

describe("dataset session registry", () => {
  it("keeps the first id when a second path is opened", () => {
    const registry = new DatasetSessionRegistry();
    registry.remember("/data/tiny.csv", "ds-tiny");
    registry.remember("/data/other.csv", "ds-other");
    assert.deepEqual(registry.idsToClose(), ["ds-tiny", "ds-other"]);
    assert.equal(registry.lookup("/data/tiny.csv"), "ds-tiny");
  });

  it("reuses the id for the same path", () => {
    const registry = new DatasetSessionRegistry();
    registry.remember("/data/tiny.csv", "ds-tiny");
    assert.equal(registry.lookup("/data/tiny.csv"), "ds-tiny");
    registry.remember("/data/tiny.csv", "ds-tiny");
    assert.deepEqual(registry.idsToClose(), ["ds-tiny"]);
  });

  it("lists both open sessions for the tree", () => {
    const registry = new DatasetSessionRegistry();
    registry.remember("/data/tiny.csv", "ds-tiny");
    registry.remember("/data/other.csv", "ds-other");
    assert.deepEqual(registry.entries(), [
      { filePath: path.resolve("/data/tiny.csv"), datasetId: "ds-tiny" },
      { filePath: path.resolve("/data/other.csv"), datasetId: "ds-other" },
    ]);
  });

  it("lists both ids for stop", () => {
    const registry = new DatasetSessionRegistry();
    registry.remember("/data/a.csv", "ds-a");
    registry.remember("/data/b.csv", "ds-b");
    assert.deepEqual(registry.idsToClose(), ["ds-a", "ds-b"]);
    registry.clear();
    assert.deepEqual(registry.idsToClose(), []);
  });
});
