import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
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

  it("passes expect unique id and balance, and fails repeated country", async () => {
    const store = new DatasetStore();
    const { handle } = await store.open(tiny);

    const id = analyzeDql("expect unique id", handle.columns);
    const idResult = await executeDql(store, handle.datasetId, id.query!, {}, {}, "u1");
    assert.equal(idResult.completion, "complete");
    assert.ok(idResult.rowCountReturned > 1);
    assert.equal(idResult.diagnostics.filter((d) => d.code === "expect-failed").length, 0);

    const country = analyzeDql("expect unique country", handle.columns);
    const countryResult = await executeDql(store, handle.datasetId, country.query!, {}, {}, "u2");
    assert.equal(countryResult.rowCountReturned, 0);
    assert.ok(
      countryResult.diagnostics.some(
        (d) => d.code === "expect-failed" && d.message.includes("MX"),
      ),
    );

    const names = analyzeDql('where country = "MX" | expect unique name', handle.columns);
    const namesResult = await executeDql(store, handle.datasetId, names.query!, {}, {}, "u3");
    assert.equal(namesResult.completion, "complete");
    assert.equal(namesResult.rowCountReturned, 2);

    const balance = analyzeDql("expect unique balance", handle.columns);
    const balanceResult = await executeDql(store, handle.datasetId, balance.query!, {}, {}, "u4");
    assert.equal(balanceResult.completion, "complete");
    assert.equal(balanceResult.diagnostics.filter((d) => d.code === "expect-failed").length, 0);

    store.close(handle.datasetId);
  });

  it("lets repeated nulls pass and rejects repeated empty strings", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "expect-unique-"));
    const nulls = path.join(dir, "nulls.csv");
    const blanks = path.join(dir, "blanks.jsonl");
    await fs.writeFile(nulls, "id,note\n1,\n2,\n", "utf8");
    await fs.writeFile(blanks, '{"id":"1","note":""}\n{"id":"2","note":""}\n', "utf8");

    const store = new DatasetStore();
    const nullOpen = await store.open(nulls);
    const nullAnalyzed = analyzeDql("expect unique note", nullOpen.handle.columns);
    const nullResult = await executeDql(
      store,
      nullOpen.handle.datasetId,
      nullAnalyzed.query!,
      {},
      {},
      "u5",
    );
    assert.equal(nullResult.completion, "complete");
    assert.equal(nullResult.diagnostics.filter((d) => d.code === "expect-failed").length, 0);
    store.close(nullOpen.handle.datasetId);

    const blankOpen = await store.open(blanks);
    const blankAnalyzed = analyzeDql("expect unique note", blankOpen.handle.columns);
    const blankResult = await executeDql(
      store,
      blankOpen.handle.datasetId,
      blankAnalyzed.query!,
      {},
      {},
      "u6",
    );
    assert.equal(blankResult.rowCountReturned, 0);
    assert.ok(blankResult.diagnostics.some((d) => d.code === "expect-failed"));
    store.close(blankOpen.handle.datasetId);
  });

  it("does not judge expect unique on a cut-short scan", async () => {
    const store = new DatasetStore();
    const { handle } = await store.open(tiny);
    const analyzed = analyzeDql("expect unique country", handle.columns);
    const result = await executeDql(
      store,
      handle.datasetId,
      analyzed.query!,
      {},
      { maxScanBytes: 1 },
      "u7",
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
