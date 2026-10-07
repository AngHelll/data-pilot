import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { scanPreview } from "./scan.js";

const tiny = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/sample/tiny.csv",
);

describe("scanPreview", () => {
  it("reads header and bounded rows", async () => {
    const result = await scanPreview(tiny, { maxRows: 2 });
    assert.deepEqual(result.header, ["id", "country", "balance", "name"]);
    assert.equal(result.rows.length, 2);
    assert.equal(result.rows[0]?.[1], "MX");
  });
});
