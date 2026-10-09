import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { analyzeDql } from "@data-pilot/dql";
import { DatasetStore } from "./session.js";
import { executeDql } from "./execute.js";
import { compareByKey } from "./compare-key.js";

const tiny = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/sample/tiny.csv",
);

/** The file moves after the opening check and before the result is sealed. */
function shiftAfterFirstCheck(store: DatasetStore): void {
  const seen = new Set<string>();
  const orig = store.assertFresh.bind(store);
  store.assertFresh = async (datasetId: string) => {
    if (!seen.has(datasetId)) {
      const first = await orig(datasetId);
      seen.add(datasetId);
      const file = store.get(datasetId).handle.revision.path;
      const stat = await fs.stat(file);
      const shifted = new Date(stat.mtimeMs + 10_000);
      await fs.utimes(file, shifted, shifted);
      return first;
    }
    return orig(datasetId);
  };
}

async function openCopy(): Promise<{ dir: string; store: DatasetStore; datasetId: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "revision-seal-"));
  const file = path.join(dir, "tiny.csv");
  await fs.copyFile(tiny, file);
  const store = new DatasetStore();
  const opened = await store.open(file);
  return { dir, store, datasetId: opened.handle.datasetId };
}

describe("revision still matches when the scan closes", () => {
  it("preview is stale-source when the file changes after the opening check", async () => {
    const { dir, store, datasetId } = await openCopy();
    try {
      shiftAfterFirstCheck(store);
      const result = await store.preview(datasetId);
      assert.notEqual(result.completion, "complete");
      assert.equal(result.completion, "error");
      assert.equal(result.rowCountReturned, 0);
      assert.equal(result.diagnostics[0]?.code, "stale-source");
    } finally {
      store.closeAll();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("query is stale-source when the file changes after the opening check", async () => {
    const { dir, store, datasetId } = await openCopy();
    try {
      const { handle } = store.describe(datasetId);
      const analyzed = analyzeDql('where country = "MX" | take 5', handle.columns);
      assert.ok(analyzed.query);
      shiftAfterFirstCheck(store);
      const result = await executeDql(store, datasetId, analyzed.query!, {}, {}, "seal");
      assert.notEqual(result.completion, "complete");
      assert.equal(result.completion, "error");
      assert.equal(result.rowCountReturned, 0);
      assert.equal(result.diagnostics[0]?.code, "stale-source");
    } finally {
      store.closeAll();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("inspect is stale-source when the file changes after the opening check", async () => {
    const { dir, store, datasetId } = await openCopy();
    try {
      shiftAfterFirstCheck(store);
      const cell = await store.inspect(datasetId, 0, "country");
      assert.ok("code" in cell);
      assert.equal(cell.code, "stale-source");
    } finally {
      store.closeAll();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("compare returns no diff when either file changes after the opening check", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "revision-seal-"));
    const store = new DatasetStore();
    try {
      const csv = "id,country\n1,MX\n2,US\n";
      const left = path.join(dir, "left.csv");
      const right = path.join(dir, "right.csv");
      await fs.writeFile(left, csv, "utf8");
      await fs.writeFile(right, csv, "utf8");
      const leftId = (await store.open(left)).handle.datasetId;
      const rightId = (await store.open(right)).handle.datasetId;
      shiftAfterFirstCheck(store);
      const result = await compareByKey(store, leftId, rightId, "id");
      assert.equal(result.completion, "error");
      assert.deepEqual(result.onlyLeft, []);
      assert.deepEqual(result.onlyRight, []);
      assert.deepEqual(result.changed, []);
      assert.ok(result.diagnostics.some((item) => item.code === "stale-source"));
    } finally {
      store.closeAll();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
