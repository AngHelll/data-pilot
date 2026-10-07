import assert from "node:assert/strict";
import test from "node:test";
import { mergeIngestDiagnostics, planLooksRunnable } from "./describe-serialize.js";

test("mergeIngestDiagnostics dedupes", () => {
  const merged = mergeIngestDiagnostics(
    [{ code: "a", severity: "warning", message: "one" }],
    [{ code: "a", severity: "warning", message: "one" }],
  );
  assert.equal(merged.length, 1);
});

test("planLooksRunnable respects error severity", () => {
  assert.equal(planLooksRunnable([{ code: "x", severity: "warning", message: "w" }]), true);
  assert.equal(planLooksRunnable([{ code: "x", severity: "error", message: "e" }]), false);
});
