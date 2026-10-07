import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { ChildProcessHost } from "./child-process-host.js";
import { resolveTsWorkerEntry } from "./paths.js";

const tiny = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/sample/tiny.csv",
);

describe("child-process dataset IPC", () => {
  it("opens, previews, queries, and closes via child process", async () => {
    const host = new ChildProcessHost({ workerEntry: resolveTsWorkerEntry() });
    await host.start();
    const opened = await host.request("openDataset", { path: tiny }, { timeoutMs: 10000 });
    assert.equal(opened.ok, true);
    if (!opened.ok) return;
    const datasetId = (opened.result as { handle: { datasetId: string } }).handle.datasetId;

    const preview = await host.request(
      "preview",
      { datasetId },
      { timeoutMs: 10000 },
    );
    assert.equal(preview.ok, true);

    const queried = await host.request(
      "executeQuery",
      { datasetId, dql: 'where country = "MX" | count' },
      { timeoutMs: 10000 },
    );
    assert.equal(queried.ok, true);
    if (queried.ok) {
      const result = queried.result as { totalCount?: number; completion: string };
      assert.equal(result.completion, "complete");
      assert.equal(result.totalCount, 2);
    }

    const closed = await host.request("closeDataset", { datasetId }, { timeoutMs: 5000 });
    assert.equal(closed.ok, true);
    await host.stop();
  });

  it("blocks executeQuery under untrusted-limited", async () => {
    const host = new ChildProcessHost({
      workerEntry: resolveTsWorkerEntry(),
      trustMode: "untrusted-limited",
    });
    await host.start();
    const opened = await host.request("openDataset", { path: tiny }, { timeoutMs: 10000 });
    assert.equal(opened.ok, true);
    if (!opened.ok) return;
    const datasetId = (opened.result as { handle: { datasetId: string } }).handle.datasetId;
    const queried = await host.request(
      "executeQuery",
      { datasetId, dql: "count" },
      { timeoutMs: 5000 },
    );
    assert.equal(queried.ok, false);
    if (!queried.ok) assert.equal(queried.error.code, "untrusted-blocked");
    await host.stop();
  });
});
