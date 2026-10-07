import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatasetStore } from "@data-pilot/engine-stream";
import { EditService } from "./edit-service.js";

test("EditService blocks untrusted and applies in trusted mode", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dp-core-edit-"));
  const file = path.join(dir, "t.csv");
  await fs.writeFile(file, "id,v\n1,a\n", "utf8");
  const store = new DatasetStore();
  const { handle } = await store.open(file);
  const blocked = new EditService(store, { trustMode: "untrusted-limited" });
  await assert.rejects(
    () => blocked.preview(handle.datasetId, 0, "v", "b"),
    (err: { code?: string }) => err.code === "untrusted-blocked",
  );
  const trusted = new EditService(store, { trustMode: "trusted" });
  const preview = await trusted.preview(handle.datasetId, 0, "v", "b");
  assert.equal(preview.newRaw, "b");
  const applied = await trusted.apply(handle.datasetId, 0, "v", "b");
  assert.equal(applied.newRaw, "b");
  assert.match(applied.afterText, /1,b/);
  const text = await fs.readFile(file, "utf8");
  assert.match(text, /1,a/);
  await fs.rm(dir, { recursive: true });
});
