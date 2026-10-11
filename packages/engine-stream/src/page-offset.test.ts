import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { analyzeDql } from "@data-pilot/dql";
import { sampleCsv } from "./csv.js";
import { executeDql } from "./execute.js";
import { fetchPagePayloadError, pageOffsetError } from "./page-offset.js";
import { DatasetStore } from "./session.js";

const tiny = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/sample/tiny.csv",
);

test("skipRows returns the next window and a cut page has no total", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dp-page-"));
  const file = path.join(dir, "rows.csv");
  const lines = ["id", ...Array.from({ length: 5 }, (_, i) => String(i + 1))];
  await fs.writeFile(file, lines.join("\n") + "\n");
  const first = await sampleCsv(file, { maxRows: 2 });
  assert.equal(first.rows.length, 2);
  assert.equal(first.truncated, true);
  assert.equal(first.rows[0]?.raw[0], "1");

  const second = await sampleCsv(file, { maxRows: 2, skipRows: 2 });
  assert.deepEqual(
    second.rows.map((row) => row.raw[0]),
    ["3", "4"],
  );
  assert.equal(second.truncated, true);

  const store = new DatasetStore();
  const { handle } = await store.open(file);
  const page = await store.preview(handle.datasetId, { maxRows: 2 }, "p", undefined, 2);
  assert.equal(page.totalCount, undefined);
  assert.deepEqual(page.sourceRowIndexes, [2, 3]);
  const refused = await store.preview(handle.datasetId, { maxRows: 2 }, "bad", undefined, 10_001);
  assert.equal(refused.completion, "error");
  assert.equal(refused.diagnostics[0]?.code, "page-offset");
  assert.equal(refused.rowCountReturned, 0);
  store.close(handle.datasetId);
  await fs.rm(dir, { recursive: true, force: true });
});

test("a query skips rows already returned and a closed page counts them", async () => {
  const store = new DatasetStore();
  const { handle } = await store.open(tiny);
  const analyzed = analyzeDql('where country = "MX"', handle.columns);
  assert.ok(analyzed.query);
  const query = analyzed.query!;
  const first = await executeDql(store, handle.datasetId, query, {}, { maxRows: 1 }, "q0");
  const second = await executeDql(store, handle.datasetId, query, {}, { maxRows: 1 }, "q1", undefined, 1);
  assert.equal(first.completion, "truncated");
  assert.equal(first.totalCount, undefined);
  assert.equal(second.completion, "complete");
  assert.equal(second.totalCount, 2);
  assert.notEqual(first.sourceRowIndexes?.[0], second.sourceRowIndexes?.[0]);
  const refused = await executeDql(
    store,
    handle.datasetId,
    query,
    {},
    { maxRows: 1 },
    "qbad",
    undefined,
    10_001,
  );
  assert.equal(refused.completion, "error");
  assert.equal(refused.diagnostics[0]?.code, "page-offset");
  store.close(handle.datasetId);
});

test("fetchPage rejects a query payload and an offset past the guard", () => {
  assert.equal(fetchPagePayloadError({ dql: "where true", offset: 0 }), "fetchPage does not run a query");
  assert.ok(pageOffsetError(10_001));
  assert.equal(pageOffsetError(0), undefined);
});
