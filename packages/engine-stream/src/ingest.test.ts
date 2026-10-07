import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { DatasetStore } from "./session.js";
import { sampleCsv } from "./csv.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const tiny = path.join(root, "fixtures/sample/tiny.csv");
const quoted = path.join(root, "fixtures/sample/quoted.csv");
const people = path.join(root, "fixtures/sample/people.jsonl");

describe("CSV/JSONL ingest", () => {
  it("samples CSV with inferred types without full count", async () => {
    const sample = await sampleCsv(tiny, { maxRows: 10 });
    assert.deepEqual(sample.header, ["id", "country", "balance", "name"]);
    assert.ok(sample.rows.length <= 10);
    const balance = sample.columns.find((c) => c.name === "balance");
    assert.ok(balance);
    assert.ok(
      balance!.inferredType === "decimal" || balance!.inferredType === "integer",
    );
  });

  it("handles quoted multiline CSV fields", async () => {
    const sample = await sampleCsv(quoted, { maxRows: 10 });
    assert.equal(sample.rows.length, 2);
    const note = sample.rows[0]?.raw[2] ?? "";
    assert.ok(note.includes("\n") || note.includes("line1"));
  });

  it("opens JSONL with missing fields tagged", async () => {
    const store = new DatasetStore();
    const { handle } = await store.open(people);
    assert.equal(handle.format, "jsonl");
    const preview = await store.preview(handle.datasetId);
    assert.ok(preview.rowCountReturned >= 4);
    // row index 3 (Dani) has missing balance
    const dani = preview.rows[3];
    const balanceIdx = preview.columns.indexOf("balance");
    assert.ok(balanceIdx >= 0);
    assert.equal(dani?.[balanceIdx]?.kind, "missing");
    store.close(handle.datasetId);
  });

  it("detects stale revision after external change", async () => {
    const store = new DatasetStore();
    const { handle } = await store.open(tiny);
    // Force mismatch
    handle.revision.mtimeMs = 1;
    const stale = await store.assertFresh(handle.datasetId);
    assert.equal(stale?.code, "stale-source");
    store.close(handle.datasetId);
  });
});
