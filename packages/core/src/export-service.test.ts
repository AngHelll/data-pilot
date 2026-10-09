import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { DatasetStore } from "@data-pilot/engine-stream";
import { ExportService } from "./export-service.js";
import { QueryService } from "./query-service.js";

const tiny = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/sample/tiny.csv",
);

test("ExportService blocks untrusted and returns content when trusted", async () => {
  const store = new DatasetStore();
  const { handle } = await store.open(tiny);
  const qs = new QueryService(store, "trusted");

  const blockedSvc = new ExportService(store, qs, { trustMode: "untrusted-limited" });
  const blocked = await blockedSvc.exportQueryResult(
    handle.datasetId,
    'where country = "MX" | take 5',
  );
  assert.ok(blocked && "code" in blocked && blocked.code === "untrusted-blocked");

  const svc = new ExportService(store, qs, { trustMode: "trusted" });
  const artifact = await svc.exportQueryResult(
    handle.datasetId,
    'where country = "MX" | take 5',
  );
  assert.ok(artifact && "content" in artifact);
  assert.match(artifact.content, /country/);
  assert.ok(artifact.rowCount > 0);
  store.close(handle.datasetId);
});

test("ExportService returns no artifact when the file changes during the scan", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "export-seal-"));
  const file = path.join(dir, "tiny.csv");
  await fs.copyFile(tiny, file);
  const store = new DatasetStore();
  const { handle } = await store.open(file);
  let checks = 0;
  const orig = store.assertFresh.bind(store);
  store.assertFresh = async () => {
    checks += 1;
    const current = await orig(handle.datasetId);
    if (checks === 2) {
      const stat = await fs.stat(file);
      const shifted = new Date(stat.mtimeMs + 10_000);
      await fs.utimes(file, shifted, shifted);
      return current;
    }
    return current;
  };
  try {
    const qs = new QueryService(store, "trusted");
    const svc = new ExportService(store, qs, { trustMode: "trusted" });
    const artifact = await svc.exportQueryResult(handle.datasetId, 'where country = "MX" | take 5');
    assert.equal("content" in artifact, false);
    assert.ok("code" in artifact);
    assert.equal(artifact.code, "stale-source");
    assert.match(artifact.message, /changed on disk/);
  } finally {
    store.close(handle.datasetId);
    await fs.rm(dir, { recursive: true, force: true });
  }
});
