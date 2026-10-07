import assert from "node:assert/strict";
import { test } from "node:test";
import { DatasetStore } from "@data-pilot/engine-stream";
import { CompareService } from "./compare-service.js";

test("CompareService blocks untrusted before scanning", async () => {
  const store = new DatasetStore();
  const blocked = new CompareService(store, { trustMode: "untrusted-limited" });
  await assert.rejects(
    () => blocked.compare("missing-left", "missing-right", "id"),
    (err: { code?: string }) => err.code === "untrusted-blocked",
  );
});
