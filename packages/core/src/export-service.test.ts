import assert from "node:assert/strict";
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
