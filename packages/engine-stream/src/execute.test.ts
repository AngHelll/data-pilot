import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { analyzeDql } from "@data-pilot/dql";
import { DatasetStore } from "./session.js";
import { executeDql } from "./execute.js";
import { stringValue, integerValue } from "@data-pilot/contracts";

const tiny = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/sample/tiny.csv",
);

describe("DQL execute streaming", () => {
  it("filters and takes rows", async () => {
    const store = new DatasetStore();
    const { handle } = await store.open(tiny);
    const analyzed = analyzeDql(
      'where country = "MX" and balance > 50000 | select id, name | take 10',
      handle.columns,
    );
    assert.ok(analyzed.query);
    assert.equal(analyzed.diagnostics.filter((d) => d.severity === "error").length, 0);
    const result = await executeDql(
      store,
      handle.datasetId,
      analyzed.query!,
      {},
      {},
      "t1",
    );
    assert.equal(result.completion, "complete");
    assert.ok(result.rowCountReturned >= 1);
    assert.deepEqual(result.columns, ["id", "name"]);
    store.close(handle.datasetId);
  });

  it("counts exactly when complete", async () => {
    const store = new DatasetStore();
    const { handle } = await store.open(tiny);
    const analyzed = analyzeDql('where country = "MX" | count', handle.columns);
    const result = await executeDql(
      store,
      handle.datasetId,
      analyzed.query!,
      {},
      {},
      "t2",
    );
    assert.equal(result.completion, "complete");
    assert.equal(result.totalCount, 2);
    assert.equal(result.rows[0]?.[0]?.kind, "integer");
    store.close(handle.datasetId);
  });

  it("supports params and find", async () => {
    const store = new DatasetStore();
    const { handle } = await store.open(tiny);
    const analyzed = analyzeDql(
      'find "Ada" | where country = $c | take 5',
      handle.columns,
      { c: stringValue("MX") },
    );
    const result = await executeDql(
      store,
      handle.datasetId,
      analyzed.query!,
      { c: stringValue("MX") },
      {},
      "t3",
    );
    assert.equal(result.rowCountReturned, 1);
    store.close(handle.datasetId);
  });

  it("is not null excludes missing-like empties correctly for CSV nulls", async () => {
    const store = new DatasetStore();
    const { handle } = await store.open(tiny);
    const analyzed = analyzeDql("where balance is not null | count", handle.columns);
    const result = await executeDql(
      store,
      handle.datasetId,
      analyzed.query!,
      {},
      {},
      "t4",
    );
    // tiny.csv row 4 has empty balance → null token
    assert.equal(result.totalCount, 4);
    void integerValue;
    store.close(handle.datasetId);
  });

  it("passes expect count when the exact count matches", async () => {
    const store = new DatasetStore();
    const { handle } = await store.open(tiny);
    const analyzed = analyzeDql('where country = "MX" | expect count = 2', handle.columns);
    assert.equal(analyzed.diagnostics.filter((d) => d.severity === "error").length, 0);
    const result = await executeDql(store, handle.datasetId, analyzed.query!, {}, {}, "t5");
    assert.equal(result.completion, "complete");
    assert.equal(result.totalCount, 2);
    assert.equal(result.rows[0]?.[0]?.kind, "integer");
    assert.equal(
      result.diagnostics.filter((d) => d.code === "expect-failed").length,
      0,
    );
    store.close(handle.datasetId);
  });

  it("fails expect count without a success row when the count differs", async () => {
    const store = new DatasetStore();
    const { handle } = await store.open(tiny);
    const analyzed = analyzeDql('where country = "MX" | expect count = 1', handle.columns);
    const result = await executeDql(store, handle.datasetId, analyzed.query!, {}, {}, "t6");
    assert.equal(result.rowCountReturned, 0);
    assert.equal(result.rows.length, 0);
    assert.ok(result.diagnostics.some((d) => d.code === "expect-failed" && d.severity === "error"));
    store.close(handle.datasetId);
  });

  it("counts rows after take for expect count", async () => {
    const store = new DatasetStore();
    const { handle } = await store.open(tiny);
    const analyzed = analyzeDql(
      'where country = "MX" | take 1 | expect count = 1',
      handle.columns,
    );
    const result = await executeDql(store, handle.datasetId, analyzed.query!, {}, {}, "t7");
    assert.equal(result.completion, "complete");
    assert.equal(result.totalCount, 1);
    store.close(handle.datasetId);
  });

  it("does not pass expect count when the scan is cut short", async () => {
    const store = new DatasetStore();
    const { handle } = await store.open(tiny);
    const analyzed = analyzeDql("expect count = 0", handle.columns);
    const result = await executeDql(
      store,
      handle.datasetId,
      analyzed.query!,
      {},
      { maxScanBytes: 1 },
      "t8",
    );
    assert.equal(result.rowCountReturned, 0);
    assert.ok(
      result.diagnostics.some(
        (d) => d.code === "expect-failed" && d.message.includes("not exact"),
      ),
    );
    store.close(handle.datasetId);
  });
});
