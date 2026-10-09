import assert from "node:assert/strict";
import test from "node:test";
import { previewIsStale } from "./stale-preview.js";

test("a stale-source diagnostic means the open session must be replaced", () => {
  assert.equal(previewIsStale([{ code: "stale-source" }]), true);
  assert.equal(previewIsStale([{ code: "parse-warning" }]), false);
  assert.equal(previewIsStale(undefined), false);
});
