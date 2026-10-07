import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { DatasetStore } from "@data-pilot/engine-stream";
import { DatasetService, QueryService } from "./index.js";

const tiny = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/sample/tiny.csv",
);

describe("core services + trust", () => {
  it("previews in untrusted-limited but blocks execute/export", async () => {
    const store = new DatasetStore();
    const ds = new DatasetService(store, "untrusted-limited");
    const qs = new QueryService(store, "untrusted-limited");
    const { handle } = await ds.open(tiny);
    const preview = await ds.preview(handle.datasetId);
    assert.ok(preview.rowCountReturned > 0);

    const exec = await qs.execute(
      handle.datasetId,
      'where country = "MX" | take 1',
    );
    assert.equal(exec.completion, "error");
    assert.equal(exec.diagnostics[0]?.code, "untrusted-blocked");

    const saved = qs.saveQueryDraft('where country = "MX"', handle.datasetId);
    assert.ok(saved && "code" in saved && saved.code === "untrusted-blocked");
    ds.close(handle.datasetId);
  });

  it("executes DQL when trusted", async () => {
    const store = new DatasetStore();
    const ds = new DatasetService(store, "trusted");
    const qs = new QueryService(store, "trusted");
    const { handle } = await ds.open(tiny);
    const result = await qs.execute(
      handle.datasetId,
      'where country = "MX" | take 10',
    );
    assert.equal(result.completion, "complete");
    assert.equal(result.rowCountReturned, 2);
    ds.close(handle.datasetId);
  });
});
